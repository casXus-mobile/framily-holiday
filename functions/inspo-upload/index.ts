// FRamily Hub — inspo photo upload. Host (or admin household) only; token checked via is_host().
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { token?: string; event?: string; caption?: string; data?: string; cover?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { token, event, caption, data, cover } = body;
  if (!token || !event || !data) return json({ error: "missing" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok, error: e1 } = await sb.rpc("is_host", { p_token: token, p_event: event });
  if (e1 || !ok) return json({ error: "not_host" }, 403);

  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(data);
  if (!m) return json({ error: "bad_image" }, 400);
  const bytes = Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0));
  if (bytes.length > 2_500_000) return json({ error: "too_big" }, 413);
  const ext = m[2] === "jpeg" ? "jpg" : m[2];
  const path = `${event}/${cover ? "cover-" : ""}${crypto.randomUUID()}.${ext}`;
  const { error: e2 } = await sb.storage.from("inspo").upload(path, bytes, { contentType: m[1], upsert: false });
  if (e2) return json({ error: "upload", detail: e2.message }, 500);
  const url = sb.storage.from("inspo").getPublicUrl(path).data.publicUrl;
  if (cover) {
    const { error: e4 } = await sb.from("events").update({ cover_url: url }).eq("id", event);
    if (e4) return json({ error: e4.message }, 400);
    return json({ ok: true, url });
  }
  const { data: list, error: e3 } = await sb.rpc("inspo_add", { p_token: token, p_event: event, p_url: url, p_path: path, p_caption: caption ?? null });
  if (e3) { await sb.storage.from("inspo").remove([path]); return json({ error: e3.message }, 400); }
  return json({ ok: true, list });
});
