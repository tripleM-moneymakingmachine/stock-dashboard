// China tab "CNY fxswap implied rates": the CNY interest rate implied by the onshore USD.CNY FX swap curve.
//  - Swap points, spot and Shibor by tenor and day: CFETS 外币隐含利率曲线 history (cm-u-bk-fx/IuirCurvHis, Shibor /
//    swap points / mean OTC spot quote parameter set), read a month at a time (CFETS's maximum window). It also carries
//    CFETS's own implied USD rate (what the swap curve says USD yields if CNY earns Shibor).
//  - Today's curve: CFETS USD.CNY FX swap curve (fx-sw-curv-USD.CNY.json, published ~16:30 Beijing), used when the
//    day is not yet in the history feed.
//  - USD leg: US Treasury daily par yield curve (bills, home.treasury.gov), read at each tenor.
// Implied CNY (simple, ACT/360) = ((F / S) × (1 + r_USD × d/360) − 1) × 360/d, with F = S + points / 10,000 and d the days
// from spot to the forward value date. "Basis to Shibor" = implied CNY − Shibor at the same tenor.
// History accumulates in the file; anything that fails keeps the previous file. Writes data/cny-fxswap.json.
// Usage: node scripts/fetch-cny-fxswap.mjs [--months=N]   (N months of back-fill on the first run, default 24)
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";

const OUT = "data/cny-fxswap.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const B = "https://www.chinamoney.com.cn";
const CF = (ref) => ({ "User-Agent": UA, Accept: "application/json, text/javascript, */*; q=0.01", Referer: ref, Origin: B, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" });
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const LOGF = "data/_fxswap-log.txt", logs = [];
const log = (...a) => { console.log(...a); logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); try { writeFileSync(LOGF, logs.join("\n")); } catch {} };
const T0 = Date.now(), BUDGET = 9 * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const today = shDate(Date.now());
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const num = (v) => { if (v == null || v === "" || v === "---") return null; const x = +String(v).replace(/,/g, ""); return isFinite(x) ? x : null; };
const r4 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
const MONTHS = +(process.argv.find((a) => a.startsWith("--months="))?.split("=")[1] || 24);

// Tenors kept in history and drawn on the curve.
const TEN = ["1W", "2W", "1M", "2M", "3M", "4M", "5M", "6M", "9M", "1Y"];
const KEY = ["1M", "2M", "3M", "6M", "9M", "1Y"];
const isTen = (s) => /^(ON|TN|SN|\d+[WMY])$/.test(s);

let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
if (existsSync("data/_probe-fxswap.txt")) rmSync("data/_probe-fxswap.txt");

// ---------- calendar: spot date (T+2 weekdays) and forward value date ----------
const wd = (d) => new Date(d + "T00:00:00Z").getUTCDay();
const addBiz = (d, n) => { let x = d; while (n > 0) { x = addDays(x, 1); if (wd(x) % 6) n--; } return x; };
const rollFwd = (d) => { let x = d; while (!(wd(x) % 6)) x = addDays(x, 1); return x; };
function valueDate(spot, t) {
  const n = +t.slice(0, -1), u = t.at(-1);
  if (u === "W") return rollFwd(addDays(spot, 7 * n));
  const dt = new Date(spot + "T00:00:00Z"), m = u === "Y" ? 12 * n : n, day = dt.getUTCDate();
  dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() + m);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return rollFwd(dt.toISOString().slice(0, 10));
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// ---------- CFETS history: Shibor / swap points / mean OTC spot quote ----------
async function cfPost(url, body, ref) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: CF(ref), body, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === 2) throw e; await sleep(1500 * (i + 1)); }
  }
}
let dumped = false, sample = null;
log(`start ${new Date().toISOString()} today=${today}`);
async function iuirWindow(start, end) {
  const ref = `${B}/chinese/bkcurvuiruuh/`;
  const body = (page, size) => `startDate=${start}&endDate=${end}&ccyPair=USD.CNY&rmdRate=23&bp=26&spotRate=28&lang=CN&pageNum=${page}&pageSize=${size}`;
  const t0 = Date.now();
  const j = await cfPost(`${B}/ags/ms/cm-u-bk-fx/IuirCurvHis`, body(1, 1000), ref);
  const recs = [...(j?.records || [])];
  const tot = j?.data?.pageTotal || 1, size = j?.data?.pageSize || 1000;
  if (!dumped && recs.length) { sample = recs.slice(0, 2); log("IuirCurvHis record sample:", JSON.stringify(recs[0])); dumped = true; }
  for (let p = 2; p <= tot; p += 5) {
    const batch = await Promise.all([p, p + 1, p + 2, p + 3, p + 4].filter((x) => x <= tot).map((x) => cfPost(`${B}/ags/ms/cm-u-bk-fx/IuirCurvHis`, body(x, size), ref).then((r) => r?.records || []).catch(() => [])));
    for (const b of batch) recs.push(...b);
  }
  log(`  window ${start}..${end}: total ${j?.data?.total}, pageSize ${size}, pages ${tot}, ${recs.length} recs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return recs;
}
// Pull the fields out of one record without depending on exact key names beyond the ones seen.
function parseRec(r) {
  if (r.ccyPairSrcEn && r.ccyPairSrcEn !== "USD.CNY") return null;
  if (r.rmbRateDesEn && r.rmbRateDesEn !== "Shibor") return null;
  if (r.spotrateDesEn && !/Mean Quote/i.test(r.spotrateDesEn)) return null;
  const d = (r.showDateCn || r.showDate || r.curveDate || "").slice(0, 10);
  let t = r.tenor || r.term || r.termCn || r.tenorCn || r.tenorEn;
  if (!t || !isTen(t)) t = Object.values(r).find((v) => typeof v === "string" && isTen(v));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !t) return null;
  return { d, t, pips: num(r.bpSrcStr), spot: num(r.spotrateStr), shibor: num(r.rmbRateStr), usdImpl: num(r.dollarRateDes ?? r.dollarRateStr) };
}

// ---------- CFETS current swap curve ----------
async function swapCurveNow() {
  const j = await cfPost(`${B}/r/cms/www/chinamoney/data/fx/fx-sw-curv-USD.CNY.json`, "t=" + Date.now(), `${B}/chinese/bkcurvfsw/`);
  const rows = (j?.data?.voArray || []).map((v) => ({ t: v.tenor, pips: num(v.points), fwd: num(v.swapAllPrc), vd: v.valueDate })).filter((r) => r.pips != null && r.fwd != null);
  const ts = j?.head?.ts;
  return { rows, date: ts ? shDate(ts) : null };
}
async function shiborNow() {
  try {
    const r = await fetch(`${B}/r/cms/www/chinamoney/data/shibor/shibor.json?t=${Date.now()}`, { headers: { "User-Agent": UA, Referer: `${B}/chinese/bkshibor/` }, signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    const o = {}; for (const x of j?.records || []) { const t = (x.termCode || "").replace("O/N", "ON"); if (t) o[t] = num(x.shibor); }
    return { date: (j?.data?.showDateCN || "").slice(0, 10) || null, o };
  } catch { return null; }
}

// ---------- US Treasury par curve (bills), history ----------
async function ustYear(yr) {
  const r = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`UST HTTP ${r.status}`);
  const lines = (await r.text()).trim().split(/\r?\n/);
  const head = lines[0].split(",").map((s) => s.replace(/"/g, "").trim());
  const ten = head.map((h) => { const m = h.match(/^([\d.]+)\s*(Mo|Month|Wk|Week|Yr|Year)/i); if (!m) return null; const u = m[2][0].toLowerCase(); return u === "m" ? +m[1] * 30.4375 : u === "w" ? +m[1] * 7 : +m[1] * 365.25; });
  const out = {};
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    const [mm, dd, yy] = c[0].replace(/"/g, "").split("/");
    const pts = ten.map((t, i) => (t != null && t <= 400 && c[i] !== "" && isFinite(+c[i]) ? [t, +c[i]] : null)).filter(Boolean).sort((a, b) => a[0] - b[0]);
    if (pts.length >= 3) out[`${yy}-${mm}-${dd}`] = pts;
  }
  return out;
}
const interp = (pts, x) => {
  if (!pts?.length) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts.at(-1)[1];
};

// ---------- build ----------
const hist = {}; // date -> tenor -> {pips, spot, shibor, usdImpl}
for (const [d, o] of Object.entries(prev?.raw || {})) hist[d] = { ...o };
const put = (x) => { (hist[x.d] ||= {})[x.t] = { pips: x.pips, spot: x.spot, shibor: x.shibor, usdImpl: x.usdImpl }; };

// Windows to read: always the latest month, then keep back-filling older months (until CFETS has no more) within a time budget,
// so the history grows over the first few runs instead of one run timing out.
const held = Object.keys(hist).sort();
let backDone = !!prev?.backDone, oldest = held[0] || today;
let fetched = 0, errs = [];
const win = async (end) => {
  const start = addDays(end, -29);
  const recs = await iuirWindow(start, end);
  let n = 0; for (const r of recs) { const x = parseRec(r); if (x) { put(x); n++; } }
  fetched += n; log(`IuirCurvHis ${start}..${end}: ${recs.length} records, ${n} USD.CNY/Shibor`);
  return { start, recs: recs.length };
};
try { await win(today); } catch (e) { errs.push(`latest: ${e.message}`); log("IuirCurvHis latest failed", e.message); }
let windows = 0;
while (!backDone && Date.now() - T0 < BUDGET && windows < MONTHS) {
  const end = addDays(Object.keys(hist).sort()[0] || oldest, -1);
  try {
    const r = await win(end); windows++;
    if (!r.recs) { backDone = true; log("no older data; back-fill complete"); }
    else if (!Object.keys(hist).some((d) => d < end)) { backDone = true; log("window added nothing older; stopping"); }
  } catch (e) { errs.push(`${end}: ${e.message}`); log("back-fill failed", end, e.message); break; }
  await sleep(300);
}

// Today's curve, if the history feed doesn't have it yet.
let live = null;
try { live = await swapCurveNow(); log(`swap curve now: ${live.rows.length} tenors, ${live.date}`); } catch (e) { errs.push("swap curve: " + e.message); }
if (live?.rows?.length && live.date && !hist[live.date]) {
  const sh = await shiborNow();
  const spot = live.rows.find((r) => r.t === "1M"); const S = spot ? r4(spot.fwd - spot.pips / 1e4) : null;
  if (sh?.o && S) for (const r of live.rows) if (TEN.includes(r.t)) put({ d: live.date, t: r.t, pips: r.pips, spot: S, shibor: sh.o[r.t] ?? null, usdImpl: null });
}

// UST bills for every date we hold
const years = [...new Set(Object.keys(hist).map((d) => d.slice(0, 4)))].sort();
const ust = {};
for (const y of years) { try { Object.assign(ust, await ustYear(y)); } catch (e) { errs.push(`UST ${y}: ${e.message}`); } }
const ustDays = Object.keys(ust).sort();
const ustOn = (d) => { let lo = 0, hi = ustDays.length - 1, best = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (ustDays[m] <= d) { best = ustDays[m]; lo = m + 1; } else hi = m - 1; } return best ? { d: best, pts: ust[best] } : null; };
if (!ustDays.length && prev?.series) { log("UST unavailable; keeping previous file"); summary("CNY fxswap: US Treasury curve unavailable, kept previous file"); process.exit(0); }

const dates = Object.keys(hist).filter((d) => d >= addDays(today, -365 * 3)).sort();
const series = {}; for (const t of TEN) series[t] = [];
const rowsFor = (d) => {
  const o = hist[d], spotD = addBiz(d, 2), u = ustOn(d);
  return TEN.map((t) => {
    const x = o[t]; if (!x || x.pips == null || !x.spot) return null;
    const vd = valueDate(spotD, t), n = days(spotD, vd);
    const F = x.spot + x.pips / 1e4;
    // Treasury par yields are bond-equivalent (ACT/365); convert to money-market ACT/360 for the CIP leg.
    const usd = u ? interp(u.pts, n) * 360 / 365 : null;
    const impl = usd == null ? null : ((F / x.spot) * (1 + usd / 100 * n / 360) - 1) * 360 / n * 100;
    return { t, n, pips: x.pips, spot: x.spot, fwd: r4(F), usd: r4(usd), impl: r4(impl), shibor: x.shibor, usdImpl: x.usdImpl, basis: impl != null && x.shibor != null ? Math.round((impl - x.shibor) * 1000) / 10 : null };
  }).filter(Boolean);
};
for (const d of dates) for (const r of rowsFor(d)) if (r.impl != null) series[r.t].push([d, r.impl, r.pips, r.usd, r.shibor]);

const last = dates.at(-1);
const curve = last ? { date: last, spotDate: addBiz(last, 2), ustDate: ustOn(last)?.d || null, rows: rowsFor(last) } : prev?.curve;
const raw = {}; for (const d of dates) raw[d] = hist[d];

const outObj = {
  updated: Date.now(), backDone, asOf: last || prev?.asOf, tenors: TEN, key: KEY, curve, series,
  src: "CFETS (chinamoney.com.cn): USD.CNY FX swap curve and 外币隐含利率曲线 history (swap points, mean OTC spot quote, Shibor, CFETS-implied USD rate). USD leg: US Treasury daily par yield curve (home.treasury.gov), bills read at each tenor, converted to ACT/360.",
  lastError: errs.length ? `${new Date().toISOString()} ${errs.join("; ")}` : undefined,
  sample,
  raw,
};
if (!dates.length && prev) { log("nothing fetched; keeping previous file"); process.exit(0); }
writeFileSync(OUT, JSON.stringify(outObj));
const c1 = curve?.rows?.find((r) => r.t === "3M");
log(`wrote ${OUT}: ${dates.length} days (${dates[0]} .. ${last}), 3M implied ${c1?.impl}% (Shibor ${c1?.shibor}%, UST ${c1?.usd}%)`);
summary(`CNY fxswap implied rates: ${dates.length} days to ${last}; 3M implied ${c1?.impl}%, basis to Shibor ${c1?.basis} bp${errs.length ? `; errors: ${errs.join("; ")}` : ""}`);
