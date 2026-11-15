// FRamily Hub — the bench: party-planning ideas for a host. Needs ANTHROPIC_API_KEY secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You are the FRamily bench: a warm, practical party-planning team for one extended family's private hub (South Florida; mixed ages, kids and grandparents; faith-friendly; budget-aware; Spanish and English speakers). A host tells you what they want to host. Reply with 2 or 3 distinct, doable concepts.

Rules: keep it real for a home or a casual venue; no alcohol-centered ideas; food should be shareable and claimable as a bring list with quantities; activities should work for 10–40 people across ages; names short and fun; one-line description under 140 characters; dress optional and short. Theme must be one of: moody, harvest, tartan, gameshow, neon, summer, brunch, confetti.

Return ONLY JSON: {"concepts":[{"name":"","lead":"","theme":"","dress":"","food":["3-6 items"],"bring":[{"label":"","qty":1,"category":"mains|sides|desserts|drinks|supplies|other"}],"activities":["3-5 items"],"tips":["1-3 short host tips"]}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { token?: string; prompt?: string; lang?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { token, prompt, lang } = body;
  if (!token || !prompt || prompt.length > 1200) return json({ error: "missing" }, 400);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "planner_off" }, 503);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: fam } = await sb.from("families").select("id,can_host,is_admin,household,name").eq("token", token).maybeSingle();
  if (!fam || !(fam.can_host || fam.is_admin)) return json({ error: "not_allowed" }, 403);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1800,
      system: SYSTEM + (lang === "es" ? "\nWrite all user-facing text in Spanish." : ""),
      messages: [{ role: "user", content: `Host: ${fam.household || fam.name || "a FRamily household"}.\nWhat they want: ${prompt}` }],
    }),
  });
  const j = await r.json();
  if (!r.ok) return json({ error: "ai", detail: j?.error?.message || r.status }, 502);
  const text = (j.content || []).map((c: { type: string; text?: string }) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const out = JSON.parse(m ? m[0] : text);
    if (!Array.isArray(out.concepts)) throw new Error("shape");
    return json({ ok: true, concepts: out.concepts.slice(0, 3) });
  } catch {
    return json({ error: "parse", raw: text.slice(0, 500) }, 502);
  }
});
