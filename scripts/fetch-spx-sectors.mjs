// S&P Sectors tab: prices for the 11 Select Sector SPDR ETFs plus SPY (cap-weighted S&P 500) and RSP (equal weight),
// and daily ETF creations/redemptions (money flows) from State Street's NAV history files.
// Writes data/spx-sectors.json:
//   { updated, src: { px, flows }, d: [YYYY-MM-DD...],
//     s:  { SYM: { c: [close], a: [adj close], h, l, v } },                 // aligned to d
//     f:  { SYM: { d: [...], nav: [...], sh: [...], fl: [$M flow...] } },   // State Street NAV history
//     fUpdated }
// Usage: node scripts/fetch-spx-sectors.mjs [all|prices]
//   prices: Yahoo only (run on every deploy so the page follows the session); flows are carried over.
//   all:    prices + State Street flows (daily workflow, spx-sectors.yml).
// A symbol or fund that fails keeps its previous data, so a deploy still goes out with the last good file.
// Flow = change in shares outstanding x NAV. Share splits (shares x k and NAV / k on the same day) count as zero flow.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const MODE = process.argv[2] || "all";
const OUT = "data/spx-sectors.json";
const PX = ["SPY", "RSP", "XLK", "XLF", "XLV", "XLY", "XLC", "XLI", "XLP", "XLE", "XLU", "XLRE", "XLB"];
const FUNDS = ["SPY", "XLK", "XLF", "XLV", "XLY", "XLC", "XLI", "XLP", "XLE", "XLU", "XLRE", "XLB"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const nyDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const r2 = (v) => (v == null ? null : +v.toFixed(2));

let old = { s: {}, f: {} };
try { old = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// ---------- Yahoo prices ----------
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
      const r = await get(`https://${host}/v8/finance/chart/${sym}?range=2y&interval=1d&includePrePost=false&events=div%2Csplit${q}`,
        { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) });
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp?.length) throw new Error("empty");
      const qd = res.indicators.quote[0], adj = res.indicators.adjclose?.[0]?.adjclose || qd.close;
      const out = {};
      res.timestamp.forEach((t, i) => {
        if (qd.close[i] == null) return;
        out[nyDate(t * 1000)] = [r2(qd.close[i]), r2(adj[i] ?? qd.close[i]), r2(qd.high[i] ?? qd.close[i]), r2(qd.low[i] ?? qd.close[i]), qd.volume[i] ?? 0];
      });
      // the live bar: Yahoo's meta price is newer than the last daily row during the session
      const m = res.meta, today = nyDate((m.regularMarketTime || 0) * 1000);
      if (m.regularMarketPrice && out[today]) { const row = out[today], k = m.regularMarketPrice / row[0]; row[1] = r2(row[1] * k); row[0] = r2(m.regularMarketPrice); }
      return { rows: out, time: m.regularMarketTime };
    } catch (e) { err = e; }
  }
  throw err;
}

const got = {}, failed = [];
let qtime = 0;
for (const s of PX) {
  try { const r = await series(s); got[s] = r.rows; qtime = Math.max(qtime, r.time || 0); }
  catch (e) { failed.push(s); console.log(s, "failed:", e.message); }
}
const out = { updated: new Date().toISOString(), src: { px: "Yahoo Finance (daily, dividend-adjusted)", flows: old.src?.flows || "" }, quoteTime: qtime || old.quoteTime || null, d: [], s: {}, f: old.f || {}, fUpdated: old.fUpdated || null };

if (got.SPY) {
  out.d = Object.keys(got.SPY).sort();
  for (const s of PX) {
    const rows = got[s];
    if (!rows) { // keep the previous series, re-aligned to the new dates
      const o = old.s?.[s], od = old.d || [];
      if (!o) continue;
      const idx = new Map(od.map((d, i) => [d, i]));
      out.s[s] = { c: [], a: [], h: [], l: [], v: [] };
      for (const d of out.d) { const i = idx.get(d); for (const k of ["c", "a", "h", "l", "v"]) out.s[s][k].push(i == null ? null : o[k][i]); }
      continue;
    }
    const x = { c: [], a: [], h: [], l: [], v: [] };
    for (const d of out.d) { const r = rows[d]; x.c.push(r ? r[0] : null); x.a.push(r ? r[1] : null); x.h.push(r ? r[2] : null); x.l.push(r ? r[3] : null); x.v.push(r ? r[4] : null); }
    out.s[s] = x;
  }
} else if (old.d?.length) { out.d = old.d; out.s = old.s; out.stale = true; }
summary(`S&P sectors prices: ${PX.length - failed.length}/${PX.length} ok${failed.length ? " (failed: " + failed.join(", ") + ")" : ""}`);
if (!got.SPY && !old.d?.length) { console.log("no price data at all"); process.exit(0); }

// ---------- State Street flows ----------
function unzipXlsx(buf) {
  let e = buf.length - 22;
  while (e > 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let k = 0; k < n; k++) {
    const m = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString(); p += 46 + nl + el + cl;
    if (!/sharedStrings\.xml$|sheet1\.xml$/.test(name)) continue;
    const st = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(st, st + cs);
    files[name] = (m === 8 ? inflateRawSync(data) : data).toString("utf8");
  }
  return files;
}
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
async function navHistory(sym) {
  const url = `https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/navhist-us-en-${sym.toLowerCase()}.xlsx`;
  const buf = Buffer.from(await (await get(url, { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*" })).arrayBuffer());
  const x = unzipXlsx(buf);
  const ss = [...(x["xl/sharedStrings.xml"] || "").matchAll(/<si>(.*?)<\/si>/gs)].map((m) => m[1].replace(/<[^>]+>/g, ""));
  const rows = [];
  for (const m of (x["xl/worksheets/sheet1.xml"] || "").matchAll(/<row [^>]*>(.*?)<\/row>/gs)) {
    const o = {};
    for (const c of m[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<v>(.*?)<\/v>)?)/g)) o[c[1]] = /t="s"/.test(c[2]) ? ss[+c[3]] : c[3];
    const dm = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(o.A || "");
    if (!dm || !o.B || !o.C) continue;
    rows.push([`${dm[3]}-${String(MON[dm[2]]).padStart(2, "0")}-${dm[1]}`, +o.B, Math.round(+o.C)]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (rows.length < 100) throw new Error(`only ${rows.length} rows`);
  const from = out.d[0] || rows.at(-520)[0];
  const f = { d: [], nav: [], sh: [], fl: [] };
  rows.forEach((r, i) => {
    let fl = 0;
    if (i) {
      const p = rows[i - 1], rs = r[2] / p[2], rn = r[1] / p[1];
      fl = rs > 1.4 && Math.abs(rs * rn - 1) < 0.08 ? 0 : ((r[2] - p[2]) * r[1]) / 1e6; // split day → no flow
    }
    if (r[0] >= from) { f.d.push(r[0]); f.nav.push(+r[1].toFixed(4)); f.sh.push(r[2]); f.fl.push(+fl.toFixed(1)); }
  });
  return f;
}

if (MODE === "all") {
  const ff = [];
  for (const s of FUNDS) {
    try { out.f[s] = await navHistory(s); }
    catch (e) { ff.push(s); console.log(s, "flows failed:", e.message); }
  }
  if (ff.length < FUNDS.length) { out.fUpdated = new Date().toISOString(); out.src.flows = "State Street Global Advisors NAV history (shares outstanding x NAV)"; }
  summary(`S&P sectors flows: ${FUNDS.length - ff.length}/${FUNDS.length} ok${ff.length ? " (failed: " + ff.join(", ") + ")" : ""}`);
}

writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${out.d.length} sessions to ${out.d.at(-1)}, flows for ${Object.keys(out.f).length} funds`);
