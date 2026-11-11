// FRamily text engine — runs every 10 min via pg_cron / scheduler.
// Dormant until settings.sms_live = '1' AND Twilio secrets exist. Pause switch: settings.sms_paused = '1'.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TZ = "America/New_York";

type Ev = { id: string; name_en: string; name_es: string; starts_at: string; venue?: string; address?: string; parking?: string; host?: string };
type Cand = { kind: string; family_id: string | null; name: string | null; phone: string; lang: string; event_id: string | null; events: Ev[] | null; extra: Record<string, any> | null };

function nyParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { hour: parseInt(p.hour) % 24, dow: p.weekday, ymd: `${p.year}-${p.month}-${p.day}` };
}
function whenStr(iso: string, lang: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" }).format(d);
  const t = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "").replace(" ", "").toLowerCase();
  return `${day} ${t}`;
}
function timeStr(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "").replace(" ", "").toLowerCase();
}
const nm = (e: Ev, lang: string) => (lang === "es" ? e.name_es || e.name_en : e.name_en);
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const first = (name: string | null) => (name || "").split(/\s+/)[0] || "";

function compose(c: Cand, site: string): string | null {
  const es = c.lang === "es";
  const L = (id: string) => `${site}#${id}`;
  const stop = es ? " · Responde STOP para salir" : " · Reply STOP to opt out";
  const evs = c.events || [];
  switch (c.kind) {
    case "invite": {
      if (!evs.length) return null;
      const hosts = [...new Set(evs.map(e => e.host).filter(Boolean))];
      const who = hosts.length === 1 ? hosts[0] : "FRamily";
      const list = evs.map(e => `${nm(e, c.lang)} ${whenStr(e.starts_at, c.lang)}`).join(", ");
      return es
        ? `FRamily: ¡Hola ${first(c.name)}! ${who} te invita: ${list}. Confirma aquí → ${L(evs[0].id)}${stop}`
        : `FRamily: Hey ${first(c.name)}! ${who} invited you: ${list}. Say you're in → ${L(evs[0].id)}${stop}`;
    }
    case "rsvp": {
      if (!evs.length) return null;
      const list = evs.map(e => `${nm(e, c.lang)} ${whenStr(e.starts_at, c.lang)}${e.venue ? " · " + e.venue : ""}`).join(", ");
      return es
        ? `FRamily: ¡Gracias, ${first(c.name)}! Estás dentro para ${list}. Cambia cuando quieras: ${L(evs[0].id)}${stop}`
        : `FRamily: Thanks, ${first(c.name)}! You're in for ${list}. Change anytime: ${L(evs[0].id)}${stop}`;
    }
    case "receipt": {
      const e = evs[0]; const amt = money(c.extra?.amount_cents || 0);
      return es ? `FRamily: Recibido — ${amt} para ${nm(e, c.lang)}. ¡Listo! 🎉` : `FRamily: Got it — ${amt} for ${nm(e, c.lang)}, you're all set 🎉`;
    }
    case "b2_in": {
      const e = evs[0]; const x = c.extra || {};
      const home = !!e.host && e.host !== "FRamily";
      let s = es ? `FRamily: ${nm(e, c.lang)} es ${whenStr(e.starts_at, c.lang)}` : `FRamily: ${nm(e, c.lang)} is ${whenStr(e.starts_at, c.lang)}`;
      s += e.address ? `, ${e.address}.` : ".";
      if (home && x.bring) s += es ? ` Llevas: ${x.bring}.` : ` You're bringing: ${x.bring}.`;
      else if (!home && e.parking) s += ` ${e.parking}.`;
      if (x.owed_cents > 0) s += es ? ` Pendiente ${money(x.owed_cents)} · Zelle ${x.zelle}.` : ` ${money(x.owed_cents)} still due · Zelle ${x.zelle}.`;
      s += es ? ` Responde Y si sigues en pie. ${L(e.id)}` : ` Reply Y if you're still coming. ${L(e.id)}`;
      return s;
    }
    case "b2_maybe": {
      const e = evs[0];
      return es
        ? `FRamily: ${nm(e, c.lang)} es ${whenStr(e.starts_at, c.lang)}. ¿Aún decidiendo? Toca Voy o No voy → ${L(e.id)}`
        : `FRamily: ${nm(e, c.lang)} is ${whenStr(e.starts_at, c.lang)}. Still deciding? Tap In or Out → ${L(e.id)}`;
    }
    case "morning": {
      const e = evs[0];
      return es
        ? `FRamily: ¡Hoy! ${nm(e, c.lang)} ${timeStr(e.starts_at)} · ${e.venue || e.address}. Nos vemos 🎉 ${L(e.id)}`
        : `FRamily: Tonight! ${nm(e, c.lang)} ${timeStr(e.starts_at)} · ${e.venue || e.address}. See you there 🎉 ${L(e.id)}`;
    }
    case "digest": {
      const e = evs[0]; const x = c.extra || {};
      let s = `FRamily digest · ${nm(e, "en")} ${whenStr(e.starts_at, "en")}: ${x.in} in (${x.heads} people)`;
      if (x.maybe) s += `, ${x.maybe} maybe`;
      if (x.unpaid_cents > 0) s += ` · ${money(x.unpaid_cents)} unpaid`;
      if (x.new_week) s += ` · ${x.new_week} new this week`;
      if (x.bring) s += ` · bringing: ${x.bring}`;
      return s + `. ${L(e.id)}`;
    }
  }
  return null;
}

function dedupe(c: Cand, ny: { ymd: string }): string {
  const ids = (c.events || []).map(e => e.id).sort().join("+");
  switch (c.kind) {
    case "invite": case "rsvp": return `${c.kind}:${c.family_id}:${ids}:${Date.now()}`; // marked via sms_mark, so unique per send
    case "receipt": return `receipt:${c.family_id}:${c.event_id}`;
    case "b2_in": case "b2_maybe": return `b2:${c.family_id}:${c.event_id}`;
    case "morning": return `m:${c.family_id}:${c.event_id}`;
    case "digest": return `d:${c.phone}:${c.event_id}:${ny.ymd}`;
  }
  return `${c.kind}:${c.phone}:${Date.now()}`;
}

function gateOpen(kind: string, ny: { hour: number; dow: string }): boolean {
  if (ny.hour < 9 || ny.hour >= 20) return false;
  if ((kind === "b2_in" || kind === "b2_maybe") && ny.hour < 10) return false;
  if (kind === "digest" && (ny.dow !== "Sun" || ny.hour < 18)) return false;
  return true;
}

async function twilio(to: string, body: string) {
  const sid = Deno.env.get("TWILIO_SID"), tok = Deno.env.get("TWILIO_TOKEN"), from = Deno.env.get("TWILIO_FROM");
  if (!sid || !tok || !from) throw new Error("twilio_secrets_missing");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: "+1" + to, From: from, Body: body }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || `twilio_${r.status}`);
  return j.sid as string;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["sms_paused", "sms_live", "site_url", "cron_key"]);
  const S = Object.fromEntries((st || []).map((r: any) => [r.key, r.value]));
  if (!S.cron_key || url.searchParams.get("k") !== S.cron_key) return new Response("nope", { status: 403 });
  if (S.sms_paused === "1") return Response.json({ paused: true });
  const live = S.sms_live === "1" && !dry;
  const site = (S.site_url || "").replace(/\/?$/, "/");
  const ny = nyParts();

  const { data: cands, error } = await sb.rpc("sms_candidates");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // one text per phone per kind-batch: dedupe household by phone
  const out: any[] = []; let sent = 0, queued = 0, skipped = 0;
  for (const c of (cands as Cand[])) {
    if (!gateOpen(c.kind, ny)) { skipped++; continue; }
    const body = compose(c, site); if (!body) { skipped++; continue; }
    const key = dedupe(c, ny);
    const ids = (c.events || []).map(e => e.id);
    if (!live) { out.push({ kind: c.kind, to: c.phone, body }); queued++; continue; }
    const ins = await sb.from("sms_outbox").insert({ dedupe_key: key, kind: c.kind, family_id: c.family_id, event_id: c.event_id, to_phone: c.phone, body }).select("id").single();
    if (ins.error) { skipped++; continue; } // duplicate → already handled
    try {
      const sid = await twilio(c.phone, body);
      await sb.from("sms_outbox").update({ status: "sent", sent_at: new Date().toISOString(), twilio_sid: sid }).eq("id", ins.data.id);
      await sb.from("sms_log").insert({ family_id: c.family_id, event_id: c.event_id, kind: c.kind, to_phone: c.phone, body, sent_at: new Date().toISOString(), twilio_sid: sid, status: "sent" });
      if (c.family_id) await sb.rpc("sms_mark", { p_kind: c.kind, p_family: c.family_id, p_events: ids });
      sent++;
    } catch (e) {
      await sb.from("sms_outbox").update({ status: "error", error: String(e) }).eq("id", ins.data.id);
      skipped++;
    }
  }
  return Response.json({ live, ny, candidates: (cands as any[]).length, sent, queued, skipped, preview: live ? undefined : out.slice(0, 20) });
});
