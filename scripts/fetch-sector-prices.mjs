// Fetches dividend-adjusted daily closes for the Portfolio tab (sector portfolio) and writes
// data/sector-prices.json: { updated, src, px: { SYMBOL: { d: [YYYY-MM-DD...], a: [adj close...] } } }.
// Symbols are every candidate in data/sector-portfolio-config.json plus the benchmarks (^IXIC, SPY).
// Yahoo chart API (cookie + crumb), 2 years by default. A symbol that fails keeps its previous
// series, so the build still runs on the last good data. Exits 0 unless every symbol failed.
// Usage: node scripts/fetch-sector-prices.mjs [RANGE=2y]
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const RANGE = process.argv[2] || "2y";
const OUT = "data/sector-prices.json";
const CFG = JSON.parse(readFileSync("data/sector-portfolio-config.json", "utf8"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const nyDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const syms = [...new Set([...Object.values(CFG.sectors).flatMap((s) => s.candidates), ...Object.values(CFG.benchmarks)])];

let old = { px: {} };
try { old = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

let cookie = "", crumb = "";
try {
  const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(10000) });
  cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  if (cookie) crumb = await (await get("https://query2.finance.yahoo.com/v1/test/getcrumb", { Cookie: cookie })).text();
} catch (e) { console.log("crumb:", e.message); }

async function series(sym) {
  const q = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
  let err;
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const r = await get(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${RANGE}&interval=1d&includePrePost=false&events=div%2Csplit${q}`,
        { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) });
      const res = (await r.json())?.chart?.result?.[0];
      const ts = res?.timestamp || [];
      const adj = res?.indicators?.adjclose?.[0]?.adjclose || res?.indicators?.quote?.[0]?.close || [];
      const d = [], a = [];
      ts.forEach((t, i) => {
        if (adj[i] == null) return;
        const day = nyDate(t * 1000);
        if (d.at(-1) === day) a[a.length - 1] = +adj[i].toFixed(4);
        else { d.push(day); a.push(+adj[i].toFixed(4)); }
      });
      if (d.length < 200) throw new Error("short history " + d.length);
      return { d, a };
    } catch (e) { err = e; }
  }
  throw err;
}

const px = {}, failed = [];
for (const s of syms) {
  try { px[s] = await series(s); }
  catch (e) { failed.push(`${s} (${e.message})`); if (old.px?.[s]) px[s] = old.px[s]; }
  await new Promise((r) => setTimeout(r, 250));
}
if (failed.length === syms.length) { console.log("every symbol failed; keeping the old file"); process.exit(0); }
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), src: "Yahoo Finance (dividend-adjusted closes)", px }) + "\n");
const msg = `sector prices: ${syms.length - failed.length}/${syms.length} fetched` + (failed.length ? `; kept previous data for ${failed.join(", ")}` : "");
console.log(msg); summary(msg);
