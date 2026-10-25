// US tab: CME Three-Month SOFR futures (SR3) strip, the SOFR fixing, and a daily settle history for the
// day-on-day, week-to-date and month-to-date changes, the curve, calendar spreads and Fed pricing panels.
//
// Sources, in order:
//  1. Delayed quotes: Yahoo Finance spark/chart for each quarterly contract (SR3<M><YY>.CME). Yahoo gives the
//     last price, the previous session's close, the day range, volume and the quote time (~10 min behind CME).
//     Yahoo does not return a daily history for these contracts, so the history is built by this script.
//  2. Daily settles: CME Group settlements (CmeWS, product 8462) for any missing trade date in the last
//     ~45 days. CME often blocks data-centre IPs; when it does, the history grows one day per run instead.
//  3. SOFR fixing and percentiles: New York Fed Markets API.
//  4. Back-fill (only while the history is short): for trade dates before the first real settle, each
//     contract's price is modelled from the dashboard's own Fed funds path (data/fedwatch.json, CBOT ZQ
//     settles): a daily SOFR path = realised fixings, then EFFR after each FOMC + the recent SOFR-EFFR spread,
//     compounded over the contract's reference quarter, plus a per-contract basis fixed so the model equals
//     the first real settle. Those points are flagged m:1 and drawn dashed; real settles always replace them.
// Anything that fails keeps the previous file's values. Writes data/sofr.json.
// Usage: node scripts/fetch-sofr.mjs        (SOFR_OFFLINE=<dir> reads quotes.json / sofr-fix.json from <dir>)
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";

const FILE = "data/sofr.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const OFF = process.env.SOFR_OFFLINE || "";
const DAY = 864e5;
const ms = (d) => Date.parse(d + "T00:00:00Z");
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const nyDate = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const MCODE = { 3: "H", 6: "M", 9: "U", 12: "Z" };
const MNAME = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const N_CONTRACTS = 14;
const KEEP_DAYS = 400;

async function get(url, headers = {}, timeout = 20000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split("?")[0]}`);
  return r;
}

// ---------- contract calendar ----------
// SR3 for month M: reference quarter runs from the third Wednesday of M to the third Wednesday of M+3; the
// contract stops trading the business day before that end date.
const thirdWed = (y, m) => { const f = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return iso(Date.UTC(y, m - 1, 1 + ((3 - f + 7) % 7) + 14)); };
export function contracts(today) {
  const out = [];
  let [y, m] = today.split("-").map(Number);
  m -= 3; while (m % 3) m--; if (m <= 0) { m += 12; y--; }
  while (out.length < N_CONTRACTS) {
    const ey = m + 3 > 12 ? y + 1 : y, em = ((m + 2) % 12) + 1;
    const start = thirdWed(y, m), end = thirdWed(ey, em), ltd = iso(ms(end) - DAY);
    if (ltd >= today) {
      const yy = String(y).slice(2), code = MCODE[m] + yy.slice(1);
      out.push({ code, sym: `SR3${MCODE[m]}${yy}.CME`, label: `${MNAME[m - 1]} ${yy}`, start, end, ltd, cme: `${MNAME[m - 1].toUpperCase()} ${yy}` });
    }
    m += 3; if (m > 12) { m -= 12; y++; }
  }
  return out;
}

// ---------- previous file ----------
let prev = {};
try { prev = JSON.parse(readFileSync(FILE, "utf8")); } catch { log("no previous sofr.json"); }
const hist = new Map((prev.hist || []).map((h) => [h.d, h]));

// ---------- 1. Yahoo delayed quotes ----------
let cookie = "", crumb = "";
async function yahooCrumb() {
  try {
    const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(10000) });
    cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    if (cookie) crumb = await (await get("https://query2.finance.yahoo.com/v1/test/getcrumb", { Cookie: cookie })).text();
  } catch (e) { log("yahoo crumb:", e.message); }
}
const pickMeta = (m) => m && m.regularMarketPrice > 80 && m.regularMarketPrice < 101 ? {
  px: +m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose ?? null,
  hi: m.regularMarketDayHigh ?? null, lo: m.regularMarketDayLow ?? null, vol: m.regularMarketVolume ?? null, t: m.regularMarketTime ?? null,
} : null;
async function yahooQuotes(list) {
  if (OFF) return JSON.parse(readFileSync(`${OFF}/quotes.json`, "utf8"));
  const out = {};
  const syms = list.map((c) => c.sym).join(",");
  for (const host of ["query1", "query2"]) {
    try {
      const q = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
      const j = await (await get(`https://${host}.finance.yahoo.com/v7/finance/spark?symbols=${syms}&range=1d&interval=1d${q}`, { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) })).json();
      for (const r of j?.spark?.result || []) { const v = pickMeta(r.response?.[0]?.meta); if (v) out[r.symbol] = v; }
      if (Object.keys(out).length >= list.length - 1) return out;
    } catch (e) { log(`spark ${host}:`, e.message); }
    if (!crumb) await yahooCrumb();
  }
  for (const c of list) if (!out[c.sym]) { // per-contract fallback
    try {
      const q = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
      const j = await (await get(`https://query2.finance.yahoo.com/v8/finance/chart/${c.sym}?range=5d&interval=1d${q}`, { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) })).json();
      const v = pickMeta(j?.chart?.result?.[0]?.meta); if (v) out[c.sym] = v;
    } catch (e) { log(`chart ${c.sym}:`, e.message); }
  }
  return out;
}

// ---------- 2. CME settlements ----------
const weekday = (d) => new Date(ms(d)).getUTCDay();
const prevBiz = (d) => { let t = ms(d) - DAY; while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY; return iso(t); };
// CME trade date of a quote: the Globex session that opens at 18:00 ET belongs to the next day.
const tradeDate = (sec) => { let d = nyDate(sec * 1000 + 6 * 3600e3); while ([0, 6].includes(weekday(d))) d = iso(ms(d) + DAY); return d; };
let cmeBlocked = !!OFF;
async function cmeSettles(d, list) {
  if (cmeBlocked) return null;
  const [y, m, dd] = d.split("-");
  try {
    const j = await (await get(`https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/8462/FUT?strategy=DEFAULT&tradeDate=${m}/${dd}/${y}&pageSize=500`,
      { Accept: "application/json", Referer: "https://www.cmegroup.com/markets/interest-rates/stirs/three-month-sofr.settlements.html" }, 12000)).json();
    const rows = j?.settlements || [];
    if (!rows.length || j.empty) return null;
    const p = {};
    for (const c of list) { const r = rows.find((x) => (x.month || "").toUpperCase() === c.cme); const v = parseFloat(String(r?.settle ?? "").replace(/[^\d.]/g, "")); if (v > 80 && v < 101) p[c.code] = v; }
    return Object.keys(p).length ? p : null;
  } catch (e) { log("CME settlements:", e.message, "(skipping CME for this run)"); cmeBlocked = true; return null; }
}

// ---------- 3. SOFR fixings ----------
async function sofrFixings(from) {
  if (OFF) return JSON.parse(readFileSync(`${OFF}/sofr-fix.json`, "utf8"));
  const to = iso(Date.now());
  const j = await (await get(`https://markets.newyorkfed.org/api/rates/secured/sofr/search.json?startDate=${from}&endDate=${to}`, { Accept: "application/json" })).json();
  return (j.refRates || []).map((r) => [r.effectiveDate, +r.percentRate, +(r.percentPercentile1 ?? NaN), +(r.percentPercentile99 ?? NaN), +(r.volumeInBillions ?? NaN)])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------- 4. model back-fill from the Fed funds path ----------
function dailyPath(snap, fix, spread, from, to) { // Map date -> SOFR
  const fx = new Map(fix.map((f) => [f[0], f[1]])), out = new Map();
  let lastFix = null;
  for (let t = ms(from); t < ms(to); t += DAY) {
    const d = iso(t);
    if (d <= snap.d) { // realised: use the fixing, carried over weekends and holidays
      if (fx.has(d)) lastFix = fx.get(d);
      if (lastFix == null) lastFix = snap.effr + spread;
      out.set(d, lastFix);
      continue;
    }
    let r = snap.effr; // expected EFFR: decision takes effect the day after the meeting
    for (const m of snap.meetings) if (d > m.d) r = m.rate;
    out.set(d, r + spread);
  }
  return out;
}
const lastMeeting = (snap) => snap.meetings.at(-1)?.d || snap.d;
export function modelPrice(c, snap, fix, spread) {
  if (c.end > iso(ms(lastMeeting(snap)) + 100 * DAY)) return null; // beyond the ZQ horizon
  const path = dailyPath(snap, fix, spread, c.start, c.end);
  let acc = 1, n = 0;
  for (const r of path.values()) { acc *= 1 + r / 100 / 360; n++; }
  return 100 - (acc - 1) * 360 / n * 100;
}

// ---------- run ----------
const today = nyDate(Date.now() + 6 * 3600e3);
const list = contracts(today);
log(`contracts: ${list.map((c) => c.code).join(" ")}`);

let fix = prev.sofr?.hist || [];
try {
  const f = await sofrFixings(iso(Date.now() - 120 * DAY));
  if (f.length) { const m = new Map(fix.map((x) => [x[0], x])); for (const x of f) m.set(x[0], x); fix = [...m.values()].sort((a, b) => a[0].localeCompare(b[0])).slice(-300); }
} catch (e) { log("SOFR fixings:", e.message); }

const quotes = {};
try { Object.assign(quotes, await yahooQuotes(list)); } catch (e) { log("quotes:", e.message); }
const prevC = Object.fromEntries((prev.contracts || []).map((c) => [c.code, c]));
let quoteTime = 0, fresh = 0;
const out = list.map((c) => {
  const q = quotes[c.sym];
  if (q) { fresh++; quoteTime = Math.max(quoteTime, q.t || 0); return { ...c, ...q }; }
  const p = prevC[c.code];
  return p ? { ...c, px: p.px, prev: p.prev, hi: p.hi, lo: p.lo, vol: p.vol, t: p.t, old: 1 } : { ...c, px: null };
});

// record the quote as this trade date's (provisional) settle; prev close goes to the previous trade date
const setH = (d, code, v, model = false) => {
  if (!(v > 80)) return;
  const h = hist.get(d) || { d, p: {} };
  if (model) { if (h.p[code] != null && !(h.mk || []).includes(code)) return; h.mk = [...new Set([...(h.mk || []), code])]; }
  else if (h.mk) { h.mk = h.mk.filter((x) => x !== code); if (!h.mk.length) delete h.mk; }
  h.p[code] = +(+v).toFixed(4); hist.set(d, h);
};
for (const c of out) {
  if (c.old || !c.t) continue;
  const td = tradeDate(c.t);
  setH(td, c.code, c.px);
  const pd = prevBiz(td);
  const h = hist.get(pd);
  if (c.prev && (!h || h.p[c.code] == null || (h.mk || []).includes(c.code))) setH(pd, c.code, c.prev);
}

// CME settles for missing / modelled trade dates over the last ~45 days (overrides provisional values)
for (let d = prevBiz(today), k = 0; k < 32 && !cmeBlocked; d = prevBiz(d), k++) {
  const h = hist.get(d);
  if (h && h.cme) continue;
  const p = await cmeSettles(d, list);
  if (p) { for (const [code, v] of Object.entries(p)) setH(d, code, v); hist.get(d).cme = 1; }
}

// model back-fill while real history is under ~45 trading days
try {
  const fw = existsSync("data/fedwatch.json") ? JSON.parse(readFileSync("data/fedwatch.json", "utf8")) : null;
  const realDates = [...hist.values()].filter((h) => Object.keys(h.p).some((k) => !(h.mk || []).includes(k))).map((h) => h.d).sort();
  if (fw && realDates.length && realDates.length < 45) {
    const snaps = new Map(fw.snapshots.filter((s) => weekday(s.d) % 6).map((s) => [s.d, s]));
    const f0 = new Map(fix.map((x) => [x[0], x[1]]));
    const effr0 = (d) => snaps.get(d)?.effr;
    const sp = (() => { const v = []; for (const [d, s] of snaps) if (f0.has(d)) v.push(f0.get(d) - s.effr); return v.length ? v.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, v.length) : 0.01; })();
    const ref = realDates[0], refSnap = snaps.get(ref) || snaps.get(prevBiz(ref));
    if (refSnap) {
      for (const c of list) {
        const real = hist.get(ref)?.p[c.code]; if (real == null || (hist.get(ref).mk || []).includes(c.code)) continue;
        const m0 = modelPrice(c, refSnap, fix, sp); if (m0 == null) continue;
        const basis = real - m0;
        for (const [d, s] of snaps) {
          if (d >= ref) continue;
          const m = modelPrice(c, s, fix, sp); if (m != null) setH(d, c.code, m + basis, true);
        }
      }
      log(`model back-fill before ${ref} (SOFR-EFFR spread ${(sp * 100).toFixed(1)}bp)`);
    }
    void effr0;
  }
} catch (e) { log("back-fill:", e.message); }

const cut = iso(Date.now() - KEEP_DAYS * DAY);
const histArr = [...hist.values()].filter((h) => h.d >= cut && weekday(h.d) % 6).sort((a, b) => a.d.localeCompare(b.d));
const lastFix = fix.at(-1);
const file = {
  updated: Math.floor(Date.now() / 1000),
  quoteTime: quoteTime || prev.quoteTime || null,
  stale: fresh === 0,
  source: "CME Three-Month SOFR futures (SR3): delayed quotes via Yahoo Finance; daily settles recorded each session (CME settlements where reachable); SOFR fixing from the New York Fed. Points marked modelled are back-filled from the CBOT fed funds futures path.",
  sofr: lastFix ? { d: lastFix[0], rate: lastFix[1], p1: lastFix[2], p99: lastFix[3], vol: lastFix[4], hist: fix } : prev.sofr,
  contracts: out,
  hist: histArr,
};
writeFileSync(FILE, JSON.stringify(file));
const z = out.find((c) => c.code[0] === "Z") || out[1];
const line = `${fresh}/${out.length} live quotes, ${histArr.length} history days (${histArr.filter((h) => h.mk).length} with modelled points); ${z?.label} ${z?.px} (prev ${z?.prev}); SOFR ${lastFix?.[1]}% on ${lastFix?.[0]}`;
log(line); summary("- SOFR futures: " + line);
