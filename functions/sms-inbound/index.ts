// Twilio inbound webhook: POST form (From, Body). URL must carry ?k=<settings.inbound_key>.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const twiml = (msg?: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message>` : ""}</Response>`, { headers: { "Content-Type": "text/xml" } });

async function send(to: string, body: string) {
  const sid = Deno.env.get("TWILIO_SID"), tok = Deno.env.get("TWILIO_TOKEN"), from = Deno.env.get("TWILIO_FROM");
  if (!sid || !tok || !from) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["inbound_key", "forward_phone", "site_url"]);
  const S = Object.fromEntries((st || []).map((r: any) => [r.key, r.value]));
  if (!S.inbound_key || url.searchParams.get("k") !== S.inbound_key) return new Response("nope", { status: 403 });

  const form = await req.formData();
  const from = String(form.get("From") || ""); const body = String(form.get("Body") || "").trim();
  const phone = from.replace(/\D/g, "").slice(-10);
  const { data: fam } = await sb.from("families").select("id,name,lang").eq("phone", phone).maybeSingle();
  const es = fam?.lang === "es";
  await sb.from("sms_log").insert({ family_id: fam?.id || null, kind: "inbound", to_phone: phone, body, sent_at: new Date().toISOString(), status: "received" });

  const u = body.toUpperCase();
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|ALTO)$/.test(u)) {
    if (fam) await sb.from("families").update({ sms_optin: false }).eq("id", fam.id);
    return twiml(); // Twilio's own opt-out reply handles the confirmation
  }
  if (/^(START|YES|UNSTOP|INICIO)$/.test(u)) {
    if (fam) await sb.from("families").update({ sms_optin: true }).eq("id", fam.id);
    return twiml(es ? "FRamily: Listo, recordatorios activados de nuevo." : "FRamily: You're back on. Reminders are on again.");
  }
  if (/^(HELP|INFO|AYUDA)$/.test(u)) {
    return twiml(es ? `FRamily: Recordatorios de eventos. Detalles: ${S.site_url} · Responde STOP para salir.` : `FRamily: Event reminders from the FRamily. Details: ${S.site_url} · Reply STOP to opt out.`);
  }
  if (/^(Y|YES|SI|SÍ|YEP|YUP|👍)$/.test(u)) {
    const { data: n } = await sb.rpc("sms_confirm", { p_phone: phone });
    return twiml(n ? (es ? "FRamily: ¡Perfecto, nos vemos! 🎉" : "FRamily: Perfect, see you there! 🎉") : (es ? "FRamily: ¡Gracias!" : "FRamily: Thanks!"));
  }
  // anything else → forward to the FRamily phone
  if (S.forward_phone) await send("+1" + S.forward_phone, `FRamily inbox · ${fam?.name || phone} (${phone}): ${body}`);
  return twiml();
});
