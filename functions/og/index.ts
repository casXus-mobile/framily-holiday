// FRamily Hub — link preview page for host-created gatherings: /functions/v1/og/<event_id>?via=…
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
Deno.serve(async (req) => {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") || u.pathname.split("/").filter(Boolean).pop() || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: e } = await sb.from("events").select("id,name_en,starts_at,venue,cover_url,host_label").eq("id", id).maybeSingle();
  const { data: s } = await sb.from("settings").select("value").eq("key", "site_url").maybeSingle();
  const site = (s?.value || "https://framilyfun.github.io/").replace(/\/?$/, "/");
  const q = u.search ? u.search.replace(/^\?/, "") : "";
  const target = `${site}#${esc(id)}${q ? "?" + q : ""}`;
  if (!e) return Response.redirect(site, 302);
  const d = new Date(e.starts_at);
  const when = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/New_York" });
  const title = `${e.name_en} · ${when}${e.venue && e.venue !== "TBD" ? " · " + e.venue : ""}`;
  const img = e.cover_url || `${site}img/og/framily.jpg`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · FRamily</title>
<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="website"><meta property="og:site_name" content="FRamily">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(e.host_label || "FRamily")} invites you. Tap to see the details and say you're in.">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(req.url)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
<script>location.replace(${JSON.stringify(target)});</script>
<style>body{margin:0;background:#16301F;color:#F3E7D0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh}a{color:#D9B56C}</style></head>
<body><p>Opening the FRamily hub… <a href="${esc(target)}">tap here</a> if it doesn't.</p></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
});
