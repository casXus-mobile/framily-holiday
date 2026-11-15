// FRamily Hub — personal calendar feed (webcal). Gatherings you're in + birthdays/anniversaries of connected households.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function esc(s: string) { return (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function ts(d: string) { return new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function fold(line: string) { const out: string[] = []; let s = line; while (s.length > 72) { out.push(s.slice(0, 72)); s = " " + s.slice(72); } out.push(s); return out.join("\r\n"); }
const slug = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return new Response("missing token", { status: 400 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: fam } = await sb.from("families").select("id,name,lang,phone,household").eq("token", token).maybeSingle();
  if (!fam) return new Response("not found", { status: 404 });
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["site_url"]);
  const SITE = ((st || []).find((r: any) => r.key === "site_url")?.value || "https://framilyfun.github.io/").replace(/\/?$/, "/");
  const es = fam.lang === "es";
  const now = ts(new Date().toISOString());
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FRamily//Hub//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:FRamily", "X-WR-TIMEZONE:America/New_York", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];

  // gatherings I'm in (published only)
  const { data: rows } = await sb.from("rsvps").select("event_id,status,headcount,players,watchers,paid_confirmed,events(id,name_en,name_es,venue,address,arrive_at,starts_at,ends_at,price_cents,host_label,zelle,status,active,custom)").eq("family_id", fam.id).eq("status", "in");
  for (const r of rows || []) {
    const e: any = (r as any).events; if (!e || !e.active || e.status !== "published") continue;
    const name = es ? e.name_es : e.name_en;
    const end = e.ends_at ? new Date(e.ends_at) : new Date(new Date(e.starts_at).getTime() + 2.5 * 3600e3);
    const n = e.id === "topgolf" ? r.players : r.headcount;
    const cost = e.price_cents ? `${es ? "Tu total" : "Your total"}: $${(n * e.price_cents / 100).toFixed(0)} (${n} x $${e.price_cents / 100}) · ${r.paid_confirmed ? (es ? "pagado" : "paid") : `Zelle ${e.zelle || "954-376-0188"}`}` : "";
    const link = e.custom ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/og/${e.id}` : `${SITE}g/${e.id}`;
    const desc = [`${name} · FRamily`, e.venue, e.address, cost, `${es ? "Anfitrión" : "Host"}: ${e.host_label || "FRamily"}`, link].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", `UID:framily-${e.id}-${fam.id}@framily`, `DTSTAMP:${now}`, `DTSTART:${ts(e.arrive_at || e.starts_at)}`, `DTEND:${ts(end.toISOString())}`, fold(`SUMMARY:${esc(name)} (FRamily)`), fold(`LOCATION:${esc([e.venue, e.address].filter(Boolean).join(", "))}`), fold(`DESCRIPTION:${esc(desc)}`), `URL:${link}`, "BEGIN:VALARM", "TRIGGER:-PT10H", "ACTION:DISPLAY", fold(`DESCRIPTION:${esc(name)} ${es ? "es hoy" : "is today"}`), "END:VALARM", "END:VEVENT");
  }

  // birthdays + anniversaries of connected households (yearly, all-day)
  const { data: cx } = await sb.rpc("cal_connections", { p_family: fam.id });
  const year = new Date().getFullYear();
  const allDay = (uid: string, md: string, summary: string, desc: string) => {
    const [mm, dd] = md.split("-"); if (!mm || !dd) return;
    const start = `${year}${mm}${dd}`;
    const d2 = new Date(Date.UTC(year, +mm - 1, +dd + 1)); const endS = `${d2.getUTCFullYear()}${String(d2.getUTCMonth() + 1).padStart(2, "0")}${String(d2.getUTCDate()).padStart(2, "0")}`;
    lines.push("BEGIN:VEVENT", `UID:${uid}@framily`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${endS}`, "RRULE:FREQ=YEARLY", fold(`SUMMARY:${esc(summary)}`), fold(`DESCRIPTION:${esc(desc)}`), "TRANSP:TRANSPARENT", "END:VEVENT");
  };
  for (const b of (cx?.birthdays || [])) {
    const who = b.own ? b.name : `${b.name} (${b.household})`;
    const age = b.year ? ` · ${es ? "nació en" : "born"} ${b.year}` : "";
    allDay(`framily-bday-${slug(b.household)}-${slug(b.name)}-${b.md}`, b.md, `🎂 ${who}${es ? " · cumpleaños" : "'s birthday"}`, `${es ? "Cumpleaños de" : "Birthday of"} ${b.name}${age} · FRamily`);
  }
  for (const a of (cx?.anniversaries || [])) {
    const yrs = a.year ? ` · ${es ? "desde" : "since"} ${a.year}` : "";
    allDay(`framily-anniv-${slug(a.household)}-${a.md}`, a.md, `💍 ${a.household}${es ? " · aniversario" : " anniversary"}`, `${es ? "Aniversario de" : "Anniversary of"} ${a.household}${yrs} · FRamily`);
  }

  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" } });
});
