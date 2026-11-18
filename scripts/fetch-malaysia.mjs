// Malaysia tab data (data/malaysia.json), the Malaysian counterpart of data/indonesia.json:
//  - MGS curve: Bank Negara Malaysia's FAST "Consolidated IYTM" for Government Securities (Conventional), the average
//    indicative yield-to-maturity contributed by the designated principal dealers each business day (MGS 1–10, 15, 20
//    and 30 years, plus Treasury bill and BNM note bands). FAST keeps every day on its own page, so history is
//    back-filled day by day (a few hundred pages per run) and every run adds the latest day.
//  - GII curve (Government Investment Issues, the Islamic government sukuk): the same FAST IYTM for Government
//    Securities (Islamic), 1–20 years. Corporate curves AAA to BBB: FAST IYTM "Corporate Bond Ratings" (3–15 years).
//  - Bonds: every MGS on FAST's "MGS Indicative Price" list (stock code, coupon, maturity, amount outstanding,
//    indicative price and yield), plus every MGS / GII that traded on Bursa Malaysia Bonds' ETP that day (BNM's
//    "Government Securities Daily Trading Information": close price and yield, volume). ISINs follow the Malaysian
//    rule "MYB" + stock code + check digit.
//  - Benchmarks: BNM's 3/5/7/10-year MGS and GII benchmark closes (FMIP / bnm.gov.my "Government Securities Yield").
//  - Funding and credit (`mm`): the OPR (decision history plus BNM's Open API), Treasury bill yields, the KL USD/MYR
//    reference rate (BNM Open API; Yahoo's USD/MYR close before the first stored day) and corporate spreads.
// Anything that fails keeps the previous file's values. Usage: node scripts/fetch-malaysia.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const OUT = "data/malaysia.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const r4 = (v) => v == null || !isFinite(v) ? null : +(+v).toFixed(4);
const r1 = (v) => v == null || !isFinite(v) ? null : +(+v).toFixed(1);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const TEN = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30]; // stored MGS tenors
const KEEP_DAYS = 5 * 366;
const BACKFILL_MAX = +(process.env.MY_BACKFILL || 450); // FAST pages fetched per run for history

async function http(url, { headers = {}, tries = 3, timeout = 40000 } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/json,*/*", ...headers }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { if (i === tries) throw e; await new Promise((s) => setTimeout(s, 1500 * i)); }
  }
}
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const trs = (h) => (h.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map((c) => strip(c)));
const num = (s) => { const v = parseFloat(String(s ?? "").replace(/[,*\s]/g, "")); return isFinite(v) ? v : null; };
const dmy = (s) => { const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const toDmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const isWk = (d) => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay());
const prevWeekday = (d) => { let t = Date.parse(d); do t -= 864e5; while ([0, 6].includes(new Date(t).getUTCDay())); return new Date(t).toISOString().slice(0, 10); };
const ttmOn = (mat, d) => (Date.parse(mat) - Date.parse(d)) / (365.25 * 864e5);
const todayKL = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const isinOf = (code) => { const b = "MYB" + code; const s = b.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55)); let sum = 0, dbl = true; for (let i = s.length - 1; i >= 0; i--) { let d = +s[i]; if (dbl) { d *= 2; if (d > 9) d -= 9; } sum += d; dbl = !dbl; } return b + ((10 - (sum % 10)) % 10); };

// ---------- curve maths (monotone cubic, as in fetch-indonesia.mjs) ----------
function mono(pts) {
  const n = pts.length; if (n < 2) return () => (n ? pts[0][1] : null);
  const x = pts.map((p) => p[0]), y = pts.map((p) => p[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (t) => {
    if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1];
    let i = 0; while (t > x[i + 1]) i++;
    const h = x[i + 1] - x[i], s = (t - x[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}
const ptsOf = (f, lo, hi) => { const p = []; for (let t = lo; t <= hi + 1e-9; t += t < 2 ? 0.05 : t < 10 ? 0.1 : 0.25) p.push([+t.toFixed(2), r4(f(t))]); return p; };

// ---------- history store helpers ----------
const mapOf = (s) => new Map(s || []);
const putSer = (m, d, v) => { if (d && v != null && isFinite(v)) m.set(d, r4(v)); };
const toSer = (m, from) => [...m.entries()].filter(([d]) => !from || d >= from).sort((a, b) => a[0].localeCompare(b[0]));
const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);

// =====================================================================================================
// 1. FAST Consolidated IYTM pages (one per category and day)
// =====================================================================================================
const FAST = "https://fast.bnm.gov.my/fastweb/public/PublicInfoServlet.do";
const CAT = { conv: ["200700000001", "00000091"], isl: ["200700000002", "00000092"], corp: ["200500000021", "00000090"] };
let ALT = prev.fast?.alt || null; // older conventional pages filed under another category / record id (found by probe)
const ALTX = prev.fast?.altx || {}, PROBED = prev.fast?.probedx || {}; // the same for the Islamic and corporate pages
const iytmUrl = (k, d, c = CAT[k]) => `${FAST}?chkBox=${c[0]}%E6${d.slice(8, 10)}%2F${d.slice(5, 7)}%2F${d.slice(0, 4)}%E6${c[1]}&mode=DISPLAY&info=INDYTM&screenId=PB030100`;
async function iytm(k, d, c) { // → { date, rows: [[label, values...]] } or null when FAST has no page for that day
  let h; try { h = await http(iytmUrl(k, d, c || (k === "conv" && ALT && d < ALT.before ? ALT.cat : ALTX[k] && d < ALTX[k].before ? ALTX[k].cat : CAT[k])), { tries: 2, timeout: 30000 }); } catch (e) { return { err: e.message }; }
  if (!h) return null;
  const at = dmy((strip(h).match(/as at\s+(\d{1,2}\/\d{1,2}\/\d{4})/i) || [])[1] || "");
  if (!at || at !== d) return null;
  const rows = trs(h).filter((r) => r.length >= 2 && /[A-Z]/.test(r[0]) && r.slice(1).some((c) => num(c) != null));
  return rows.length ? { date: at, rows } : null;
}
// FAST renamed its government categories ("... New") in early 2026; older days sit under another id. Probe a few
// candidates on one older weekday and use the first that returns MGS rows.
async function probeAlt(d) {
  const cats = ["200700000001", "200500000019", "200500000018", "200500000017", "200500000016", "200500000022", "200500000023"];
  for (const c of cats) for (let q = 70; q <= 95; q++) {
    const cc = [c, String(q).padStart(8, "0")]; if (cc[0] === CAT.conv[0] && cc[1] === CAT.conv[1]) continue;
    const p = await iytm("conv", d, cc);
    if (p && !p.err && parseGov(p.rows, "MGS").pts.length >= 6) { log(`FAST probe: older conventional pages at ${cc.join("/")} (${d})`); return cc; }
  }
  log(`FAST probe: no older conventional category found for ${d}`); return null;
}
async function probeX(k, d) { // Islamic / corporate: same category id, older record ids
  for (let q = 70; q <= 95; q++) {
    const cc = [CAT[k][0], String(q).padStart(8, "0")]; if (cc[1] === CAT[k][1]) continue;
    const p = await iytm(k, d, cc);
    const ok = p && !p.err && (k === "isl" ? parseGov(p.rows, "GII").pts.length >= 5 : Object.keys(parseCorp(p.rows)).length >= 3);
    if (ok) { log(`FAST probe: older ${k} pages at ${cc.join("/")} (${d})`); return cc; }
  }
  log(`FAST probe: no older ${k} record found for ${d}`); return null;
}
const parseGov = (rows, pre) => { // "MGS 10 YEARS" / "GII 1 YEAR" → [[tenor, y]]; bills by band
  const out = [], bills = {};
  for (const r of rows) {
    const m = r[0].match(new RegExp(`^${pre}\\s+(\\d+)\\s+YEARS?`, "i")); const v = num(r[1]);
    if (m && v != null) out.push([+m[1], v]);
    const b = r[0].match(/^(BNMNI?|MI?TB)\s+BAND\s+(\d+)/i); if (b && v != null) bills[`${b[1].toLowerCase()}${b[2]}`] = v;
  }
  return { pts: out.sort((a, b) => a[0] - b[0]), bills };
};
const CORP = [["aaa", /^AAA/], ["aa1", /^AA1/], ["aa", /^AA2/], ["aa3", /^AA3/], ["a1", /^A1/], ["a", /^A2/], ["a3", /^A3/], ["bbb", /^BBB/]];
const CORP_T = [3, 5, 7, 10, 15];
const parseCorp = (rows) => { const o = {}; for (const r of rows) { const k = CORP.find(([, re]) => re.test(r[0]))?.[0]; if (!k) continue; const v = r.slice(1, 6).map(num); if (v.filter((x) => x != null).length >= 3) o[k] = CORP_T.map((t, i) => [t, v[i]]).filter(([, y]) => y != null); } return o; };

// day stores: { conv: {date: [[t,y]]}, isl: {...}, corp: {date: {aaa: [[t,y]]...}}, bills: {date: {...}} }
const days = { conv: new Map(Object.entries(prev.fast?.conv || {})), isl: new Map(Object.entries(prev.fast?.isl || {})), corp: new Map(Object.entries(prev.fast?.corp || {})), bills: new Map(Object.entries(prev.fast?.bills || {})) };
const miss = new Set(prev.fast?.miss || []); // weekdays FAST has no conventional page for (holidays)
async function takeDay(d, cats = ["conv", "isl", "corp"]) {
  let got = 0, err = 0;
  for (const k of cats) {
    if (days[k].has(d)) { got++; continue; }
    const p = await iytm(k, d);
    if (p?.err) { err++; continue; }
    if (!p) continue;
    if (k === "conv") { const g = parseGov(p.rows, "MGS"); if (g.pts.length >= 6) { days.conv.set(d, g.pts); if (Object.keys(g.bills).length) days.bills.set(d, g.bills); got++; } }
    else if (k === "isl") { const g = parseGov(p.rows, "GII"); if (g.pts.length >= 5) { days.isl.set(d, g.pts); const b = days.bills.get(d) || {}; days.bills.set(d, { ...b, ...g.bills }); got++; } }
    else { const c = parseCorp(p.rows); if (Object.keys(c).length >= 3) { days.corp.set(d, c); got++; } }
  }
  return { got, err };
}
// latest days: today (KL) back to the last stored day
let latest = null, fastErr = 0;
{
  let d = todayKL; if (!isWk(d)) d = prevWeekday(d);
  for (let i = 0; i < 8; i++) {
    const r = await takeDay(d); fastErr += r.err;
    if (days.conv.has(d)) { latest ||= d; } else if (!r.err && d < todayKL) miss.add(d);
    const stored = [...days.conv.keys()].sort().at(-1);
    if (latest && (i >= 1 && stored && d <= stored)) break;
    d = prevWeekday(d);
  }
  latest ||= [...days.conv.keys()].sort().at(-1) || null;
  log(`FAST IYTM latest ${latest} (conv ${days.conv.size} days, Islamic ${days.isl.size}, corporate ${days.corp.size}; ${fastErr} errors)`);
}
// back-fill: walk back from the earliest stored day, newest first, a limited number of pages per run
{
  let budget = BACKFILL_MAX, n = 0, gap = 0, d = [...days.conv.keys()].sort()[0] || latest;
  const stop = prev.fast?.backStop || null;
  // Islamic and corporate histories trail the conventional one: fill their gaps over the last year first
  const fails = { isl: 0, corp: 0 };
  for (const dd of [...days.conv.keys()].sort().reverse()) {
    if (budget <= 0) break;
    for (const k of ["isl", "corp"]) {
      if (days[k].has(dd) || budget <= 0 || (fails[k] >= 15 && (ALTX[k] || PROBED[k]))) continue;
      budget--; await takeDay(dd, [k]);
      if (days[k].has(dd)) { fails[k] = 0; continue; }
      const earliest = [...days[k].keys()].sort()[0];
      if (++fails[k] >= 5 && earliest && dd < earliest && !ALTX[k] && !PROBED[k]) {
        PROBED[k] = true; budget -= 25; const cc = await probeX(k, dd);
        if (cc) { ALTX[k] = { cat: cc, before: earliest }; fails[k] = 0; budget--; await takeDay(dd, [k]); }
      }
    }
  }
  let backStop = ALT || prev.fast?.probed ? stop : null;
  if (d && (!stop || (!ALT && !prev.fast?.probed))) {
    while (budget > 0 && d > cutoff) {
      d = prevWeekday(d);
      if (miss.has(d)) continue;
      budget--; const r = await takeDay(d, ["conv"]);
      if (days.conv.has(d)) { n++; gap = 0; } else if (!r.err) { miss.add(d); gap++; }
      if (gap >= 20) {
        const earliest = [...days.conv.keys()].sort()[0];
        if (!ALT && !prev.fast?.probed) {
          days.probed = true; const cc = await probeAlt(d); budget -= 40;
          if (cc) { ALT = { cat: cc, before: earliest }; for (const x of [...miss]) if (x < earliest) miss.delete(x); d = earliest; gap = 0; continue; }
        }
        backStop = d; log(`FAST back-fill: 20 weekdays without a page before ${d}; history starts after it`); break;
      }
    }
    if (d <= cutoff) backStop = cutoff;
  }
  log(`FAST back-fill: +${n} conventional days, earliest ${[...days.conv.keys()].sort()[0]}, budget left ${budget}`);
  days.backStop = backStop;
}

// =====================================================================================================
// 2. MGS indicative prices (all MGS) and the day's ETP trades (MGS and GII)
// =====================================================================================================
let indi = null;
if (latest) {
  try {
    const rows = [];
    for (let p = 1; p <= 6; p++) {
      const h = await http(`${FAST}?chkBox=${toDmy(latest)}&mode=DISPLAY&info=MGSINDI&screenId=PB030200&page=${p}`);
      if (!h) break;
      const got = trs(h).filter((r) => /^[A-Z]{2}\d{6}$/.test(r[0]) && r.length >= 9);
      const fresh = got.filter((r) => !rows.some((x) => x[0] === r[0])); rows.push(...fresh);
      if (!fresh.length || !new RegExp(`page=${p + 1}`).test(h)) break;
    }
    indi = rows.map((r) => { const n = r.length; return { code: r[0], coupon: num(r[1]), mat: dmy(r[2]), out: num(r[3]), px: num(r[n - 3]), y: num(r[n - 2]) }; }).filter((b) => b.mat && b.y != null);
    log(`MGS indicative ${latest}: ${indi.length} stocks`);
    if (indi.length < 10) indi = null;
  } catch (e) { log(`MGS indicative failed: ${e.message}`); }
}
let trades = null, tradeDate = null;
try {
  const h = await http("https://www.bnm.gov.my/gstdi");
  if (h) {
    tradeDate = dmy((strip(h).match(/Trading date[^0-9]{0,40}(\d{1,2}\/\d{1,2}\/\d{4})/i) || [])[1] || "") || latest;
    const rows = trs(h).filter((r) => r.length >= 11 && /^[A-Z]{2}\d{6}$/.test(r[3]));
    trades = rows.map((r) => ({ name: r[0].replace(/\*/g, "").trim(), bench: /\*/.test(r[0]), coupon: num(r[1]), mat: dmy(r[2]), code: r[3], px: num(r[8]), y: num(r[9]), vol: num(r[10]) })).filter((b) => b.mat && b.y != null);
    log(`ETP trades ${tradeDate}: ${trades.length} government securities`);
  }
} catch (e) { log(`BNM daily trading page failed: ${e.message}`); }

// =====================================================================================================
// 3. Benchmarks: BNM's 3/5/7/10Y MGS and GII closes, and Treasury bill / BNM note yields
// =====================================================================================================
let bench = null;
for (const url of ["https://financialmarkets.bnm.gov.my/benchmark-yields", "https://www.bnm.gov.my/government-securities-yield"]) {
  try {
    const h = await http(url); if (!h) continue;
    const txt = strip(h), dt = (txt.match(/Trading Date:?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i) || [])[1];
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const date = dt ? (() => { const [d, m, y] = dt.split(/\s+/); return `${y}-${String(MON[m.slice(0, 3).toLowerCase()]).padStart(2, "0")}-${d.padStart(2, "0")}`; })() : null;
    const R = trs(h); let sec = null; const out = { mgs: [], gii: [], bills: {} };
    for (const r of R) {
      const j = r.join(" ");
      if (/Conventional/i.test(j) && /MGS/.test(j)) sec = "mgs"; else if (/Islamic/i.test(j)) sec = "gii"; else if (/Short-Term Bills/i.test(j)) sec = "bills";
      const tn = r[0].match(/^(\d+)(?:Y|-year)/i);
      if (tn && (sec === "mgs" || sec === "gii")) {
        const nums = r.slice(1).map((c) => c.trim());
        // MGS: maturity, coupon, low, high, close, volume, change. GII: maturity, (blank), low, high, close, volume, change
        const vals = nums.filter((c, i) => i > 0 && c !== "");
        const close = num(sec === "mgs" ? vals[3] : vals.length >= 6 ? vals[vals.length - 3] : vals[2]);
        const chg = num(vals.at(-1)), vol = num(vals.at(-2));
        out[sec].push({ t: +tn[1], matTxt: nums[0], coupon: sec === "mgs" ? num(vals[0]) : null, y: close, chg, vol, last: /\*/.test(j) });
      }
      if (sec === "bills") { const k = /Monetary Notes.*Islamic/i.test(r[0]) ? "bnmni" : /Monetary Notes/i.test(r[0]) ? "bnmn" : /Islamic Treasury/i.test(r[0]) ? "mitb" : /Treasury Bills/i.test(r[0]) ? "mtb" : null; const v = r.slice(1).map(num).filter((x) => x != null); if (k && v.length >= 3) out.bills[k] = v.slice(0, 3); }
    }
    if (out.mgs.length >= 3) { bench = { date: date || latest, ...out, src: url }; log(`benchmarks ${bench.date} from ${url}: MGS ${out.mgs.map((b) => b.t + "Y " + b.y).join(", ")}`); break; }
  } catch (e) { log(`benchmarks ${url} failed: ${e.message}`); }
}

// =====================================================================================================
// 4. OPR and the KL USD/MYR reference rate (BNM Open API), USD/MYR back-fill from Yahoo
// =====================================================================================================
const API = { Accept: "application/vnd.BNM.API.v1+json" };
// OPR decisions since 2020 (MPC statements); the API adds any later change
const OPR0 = [["2020-01-22", 2.75], ["2020-03-03", 2.5], ["2020-05-05", 2.0], ["2020-07-07", 1.75], ["2022-05-11", 2.0], ["2022-07-06", 2.25], ["2022-09-08", 2.5], ["2022-11-03", 2.75], ["2023-05-03", 3.0], ["2025-07-09", 2.75]];
const oprDec = new Map([...OPR0, ...(prev.oprDecisions || [])]);
try {
  const j = JSON.parse(await http("https://api.bnm.gov.my/public/opr", { headers: API }) || "null");
  const x = j?.data; const v = num(x?.new_opr_level), d = x?.date;
  if (v != null && d) { const last = toSer(oprDec).at(-1); if (!last || last[1] !== v) oprDec.set(d, v); log(`OPR (API): ${v}% since ${d}`); }
} catch (e) { log(`OPR API failed: ${e.message}`); }
const oprDecisions = toSer(oprDec);
const usdmyr = new Map(prev.mm?.series?.usdmyr || []);
for (const path of ["kl-usd-reference-rate", ...(() => { const out = []; const t = new Date(Date.parse(todayKL)); for (let k = 0; k < (usdmyr.size > 100 ? 1 : 3); k++) { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - k, 1)); out.push(`kl-usd-reference-rate/year/${d.getUTCFullYear()}/month/${d.getUTCMonth() + 1}`); } return out; })()]) {
  try {
    const j = JSON.parse(await http(`https://api.bnm.gov.my/public/${path}`, { headers: API }) || "null");
    const arr = Array.isArray(j?.data) ? j.data : j?.data ? [j.data] : [];
    let n = 0; for (const x of arr) { const d = x.date, v = num(x.rate); if (d && v) { usdmyr.set(d.slice(0, 10), v); n++; } }
    log(`KL USD/MYR reference (${path}): ${n} days`);
  } catch (e) { log(`KL USD/MYR reference ${path} failed: ${e.message}`); }
}
let fxBackfill = prev.fxBackfill || null;
if (usdmyr.size < 200) {
  try {
    const j = JSON.parse(await http("https://query1.finance.yahoo.com/v8/finance/chart/MYR%3DX?range=5y&interval=1d"));
    const r = j.chart.result[0], ts = r.timestamp, c = r.indicators.quote[0].close;
    let n = 0; for (let i = 0; i < ts.length; i++) { const d = new Date(ts[i] * 1000).toISOString().slice(0, 10); if (!isWk(d) || !c[i] || usdmyr.has(d)) continue; usdmyr.set(d, +c[i].toFixed(4)); n++; }
    fxBackfill = [...usdmyr.keys()].sort()[0] || null; log(`USD/MYR back-fill from Yahoo: ${n} days`);
  } catch (e) { log(`USD/MYR back-fill failed: ${e.message}`); }
}

// =====================================================================================================
// 5. Assemble
// =====================================================================================================
const convDays = [...days.conv.keys()].sort();
const tenMaps = Object.fromEntries(TEN.map((t) => [t, new Map()]));
for (const d of convDays) { const p = days.conv.get(d); const f = mono(p); for (const t of TEN) if (p.some(([x]) => x >= t) || t <= p.at(-1)[0]) putSer(tenMaps[t], d, p.some(([x]) => x === t) ? p.find(([x]) => x === t)[1] : f(t)); }
const tenors = Object.fromEntries(TEN.map((t) => [t, toSer(tenMaps[t], cutoff)]).filter(([, s]) => s.length));
const curveDate = convDays.at(-1) || null;
const fNow = curveDate ? mono(days.conv.get(curveDate)) : null;
const curve = curveDate ? { date: curveDate, pts: ptsOf(fNow, 1, days.conv.get(curveDate).at(-1)[0]), raw: days.conv.get(curveDate) } : prev.curve || null;

// GII and corporate curves
const islDays = [...days.isl.keys()].sort(), corpDays = [...days.corp.keys()].sort();
const pb = {};
{
  const iT = [1, 2, 3, 4, 5, 7, 10, 15, 20], m = Object.fromEntries(iT.map((t) => [t, new Map()]));
  for (const d of islDays) { const p = days.isl.get(d), f = mono(p); for (const t of iT) if (t <= p.at(-1)[0]) putSer(m[t], d, f(t)); }
  const dI = islDays.at(-1);
  if (dI) { const p = days.isl.get(dI), f = mono(p); pb.gii = { short: "GII", name: "Government Investment Issues (GII, Islamic government sukuk)", local: "Terbitan Pelaburan Kerajaan", fitted: false, curve: { date: dI, pts: ptsOf(f, 1, p.at(-1)[0]) }, tenors: Object.fromEntries(iT.map((t) => [t, toSer(m[t], cutoff)]).filter(([, s]) => s.length)), bonds: [] }; }
  const dC = corpDays.at(-1);
  const NAMES = { aaa: "AAA", aa1: "AA1 / AA+", aa: "AA2 / AA", aa3: "AA3 / AA−", a1: "A1 / A+", a: "A2 / A", a3: "A3 / A−", bbb: "BBB" };
  for (const [k] of CORP) {
    const mm = Object.fromEntries(CORP_T.map((t) => [t, new Map()]));
    for (const d of corpDays) { const p = days.corp.get(d)?.[k]; if (p) for (const [t, y] of p) putSer(mm[t], d, y); }
    const p = dC && days.corp.get(dC)?.[k]; if (!p || p.length < 3) continue;
    const f = mono(p);
    pb[k] = { short: k === "aaa" ? "AAA" : NAMES[k].split(" ")[0], name: `Corporate ${NAMES[k]} (ringgit, rated by RAM / MARC)`, local: "FAST consolidated IYTM, corporate bond ratings", fitted: false, curve: { date: dC, pts: ptsOf(f, p[0][0], p.at(-1)[0]) }, tenors: Object.fromEntries(CORP_T.map((t) => [t, toSer(mm[t], cutoff)]).filter(([, s]) => s.length)), bonds: [] };
  }
}
if (!Object.keys(pb).length && prev.pb) Object.assign(pb, prev.pb);
const fGii = pb.gii ? mono(days.isl.get(pb.gii.curve.date) || []) : null;

// register: every MGS / GII seen on the indicative list or the ETP, kept across runs
const today = new Date().toISOString().slice(0, 10);
const reg = new Map((prev.register || []).map((b) => [b.code, b]));
const typeOf = (code) => (code[0] === "G" ? "GII" : "MGS");
const seen = (b, src) => { const o = reg.get(b.code) || { code: b.code, first: prev.register ? today : null }; reg.set(b.code, { ...o, isin: isinOf(b.code), iss: typeOf(b.code), coupon: b.coupon ?? o.coupon ?? null, mat: b.mat || o.mat, out: b.out != null ? b.out * 1e6 : o.out ?? null, name: b.name || o.name || `${typeOf(b.code)} ${b.mat?.slice(5, 7)}/${b.mat?.slice(2, 4)}`, src: o.src ? [...new Set([...o.src, src])] : [src] }); };
for (const b of indi || []) seen(b, "indicative");
for (const b of trades || []) seen(b, "etp");
const register = [...reg.values()].filter((b) => b.mat && b.mat > today);

// bonds: indicative yield (MGS) and the day's ETP close (MGS and GII), with the spread to their curve
const day = curveDate || today;
const indiBy = new Map((indi || prev.indi || []).map((b) => [b.code, b]));
// previous day's indicative yields: the stored list when it is from an earlier day, else what was kept with it
const indiPrev = indi && prev.indiDate && prev.indiDate !== curveDate ? new Map((prev.indi || []).map((b) => [b.code, b.y])) : new Map(prev.indiPrev || []);
const trBy = new Map((trades || []).map((b) => [b.code, b]));
const curveFor = (code, ttm) => typeOf(code) === "GII" ? (fGii ? fGii(ttm) : null) : fNow ? fNow(ttm) : null;
const benchCodes = new Set((trades || []).filter((b) => b.bench).map((b) => b.code));
const bonds = register.map((b) => {
  const ttm = ttmOn(b.mat, day); if (ttm <= 0) return null;
  const i = indiBy.get(b.code), t = trBy.get(b.code), c = ttm >= 0.25 ? curveFor(b.code, Math.max(1, ttm)) : null;
  const last = i?.y ?? t?.y ?? null, p0 = indiPrev.get(b.code);
  return { code: b.code, isin: b.isin, name: b.name, type: b.iss, iss: b.iss, coupon: b.coupon, issue: b.first || null, mat: b.mat, ttm: r4(ttm), out: b.out ?? null, curve: r4(c), last: r4(last), px: i?.px ?? t?.px ?? null, trd: t ? r4(t.y) : null, vol: t?.vol ?? null, bench: benchCodes.has(b.code) || undefined, chg: i && p0 != null ? r1((i.y - p0) * 100) : null, vs: last != null && c != null && ttm >= 1 ? r1((last - c) * 100) : null };
}).filter(Boolean).sort((a, b) => a.ttm - b.ttm);
if (pb.gii) pb.gii.bonds = bonds.filter((b) => b.iss === "GII" && b.last != null);

// benchmarks: BNM's 3/5/7/10Y closes, matched to stock codes by maturity month and year
const MONS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ym = (s) => { const m = String(s).match(/([A-Za-z]{3})[A-Za-z]*[-\s]+(\d{4})/); return m ? `${m[2]}-${String(MONS[m[1].toLowerCase()]).padStart(2, "0")}` : null; };
const bmRows = (list, iss) => (list || []).map((x) => {
  const k = ym(x.matTxt), b = register.find((r) => r.iss === iss && r.mat.slice(0, 7) === k && (x.coupon == null || Math.abs((r.coupon || 0) - x.coupon) < 0.01)) || register.find((r) => r.iss === iss && r.mat.slice(0, 7) === k);
  const ttm = b ? ttmOn(b.mat, day) : x.t, c = iss === "GII" ? fGii?.(ttm) : fNow?.(ttm);
  return { code: b?.code || `${iss} ${x.t}Y`, tenor: x.t, isin: b?.isin || null, name: `${x.t}Y ${iss} benchmark`, mat: b?.mat || null, matTxt: x.matTxt, est: !b, ttm: r4(ttm), coupon: b?.coupon ?? x.coupon, last: x.y, px: trBy.get(b?.code)?.px ?? indiBy.get(b?.code)?.px ?? null, chg: x.chg, vol: x.vol, stale: x.last || undefined, curve: r4(c), vs: c != null && x.y != null ? r1((x.y - c) * 100) : null, iss };
}).sort((a, b) => a.tenor - b.tenor);
const benchmarks = bench ? { date: bench.date, mgs: bmRows(bench.mgs, "MGS"), gii: bmRows(bench.gii, "GII"), bills: bench.bills, src: bench.src } : prev.benchmarks || null;
const benchHist = Object.fromEntries(Object.entries(prev.benchHist || {}).map(([k, v]) => [k, new Map(v.map((r) => [r[0], r]))]));
if (benchmarks && bench) for (const b of [...benchmarks.mgs, ...benchmarks.gii]) { const key = `${b.iss} ${b.tenor}Y`; const m = (benchHist[key] ||= new Map()); if (b.last != null) m.set(benchmarks.date, [benchmarks.date, b.last, b.code, b.vs]); }
const benchOut = Object.fromEntries(Object.entries(benchHist).map(([k, m]) => [k, [...m.values()].filter((r) => r[0] >= cutoff).sort((a, b) => a[0].localeCompare(b[0]))]).filter(([, v]) => v.length));

// funding and credit series
const opr = new Map();
if (oprDecisions.length) {
  let i = 0;
  for (let t = Date.parse(cutoff); t <= Date.parse(todayKL); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10); if (!isWk(d)) continue;
    while (i + 1 < oprDecisions.length && oprDecisions[i + 1][0] <= d) i++;
    if (oprDecisions[i][0] <= d) opr.set(d, oprDecisions[i][1]);
  }
}
const S = { mgs1: new Map(), mgs3: new Map(), mgs5: new Map(), mgs10: new Map(), gii3: new Map(), gii10: new Map(), mtb1: new Map(), mtb10: new Map(), bnmn1: new Map(), aaa3: new Map(), aaa5: new Map(), aaa10: new Map(), aa13: new Map(), aa3: new Map(), aa5: new Map(), a3: new Map(), bbb3: new Map() };
for (const [t, k] of [[1, "mgs1"], [3, "mgs3"], [5, "mgs5"], [10, "mgs10"]]) for (const [d, y] of tenors[t] || []) S[k].set(d, y);
for (const [t, k] of [[3, "gii3"], [10, "gii10"]]) for (const [d, y] of pb.gii?.tenors?.[t] || []) S[k].set(d, y);
for (const [d, b] of days.bills) { putSer(S.mtb1, d, b.mtb1); putSer(S.mtb10, d, b.mtb10); putSer(S.bnmn1, d, b.bnmn1); }
for (const [d, c] of days.corp) for (const [k, ck, t] of [["aaa3", "aaa", 3], ["aaa5", "aaa", 5], ["aaa10", "aaa", 10], ["aa13", "aa1", 3], ["aa3", "aa", 3], ["aa5", "aa", 5], ["a3", "a", 3], ["bbb3", "bbb", 3]]) putSer(S[k], d, c[ck]?.find(([x]) => x === t)?.[1]);
const mm = { series: { opr: toSer(opr, cutoff), usdmyr: toSer(usdmyr, cutoff), ...Object.fromEntries(Object.entries(S).map(([k, m]) => [k, toSer(m, cutoff)])) } };

const trim = (m) => Object.fromEntries([...m.entries()].filter(([d]) => d >= cutoff).sort((a, b) => a[0].localeCompare(b[0])));
const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "Bank Negara Malaysia: FAST consolidated indicative yield-to-maturity (MGS, GII, corporate ratings), MGS indicative prices, Government Securities Daily Trading Information (Bursa Malaysia Bonds ETP), benchmark yields (FMIP), OPR and KL USD/MYR reference rate (BNM Open API); Yahoo USD/MYR before the first stored reference rate",
  curve, tenors, igsDays: convDays.filter((d) => d >= cutoff),
  bonds, register,
  tradeDay: curveDate, prevTradeDay: tenors[10]?.length > 1 ? tenors[10].at(-2)[0] : null, tradeTime: curveDate ? `${curveDate} FAST IYTM` : null, etpDay: tradeDate,
  benchmarks, benchHist: benchOut,
  pb, mm, oprDecisions, fxBackfill,
  indi: indi || prev.indi || null, indiDate: indi ? curveDate : prev.indiDate || null, indiPrev: [...indiPrev],
  pbTradeDay: pb.gii?.curve?.date || curveDate, pbSrc: "GII: FAST consolidated IYTM for Government Securities (Islamic). Corporate AAA–BBB: FAST consolidated IYTM by rating (3–15 years)",
  counts: { register: register.length, mgs: bonds.filter((b) => b.iss === "MGS").length, gii: bonds.filter((b) => b.iss === "GII").length, priced: bonds.filter((b) => b.last != null).length, traded: bonds.filter((b) => b.trd != null).length },
  fast: { conv: trim(days.conv), isl: trim(days.isl), corp: trim(days.corp), bills: trim(days.bills), miss: [...miss].filter((d) => d >= cutoff).sort(), backStop: days.backStop || null, alt: ALT, altx: ALTX, probedx: PROBED, probed: days.probed || prev.fast?.probed || false },
};
if (!out.curve) { log("No MGS curve at all; not writing."); process.exit(0); }
writeFileSync(OUT, JSON.stringify(out));
const t10 = tenors[10]?.at(-1);
log(`wrote ${OUT}: curve ${curve.date}, 10Y ${t10?.[1]} (${tenors[10]?.length} days from ${tenors[10]?.[0]?.[0]}), bonds ${bonds.length} (${out.counts.priced} priced, ${out.counts.traded} traded), OPR ${mm.series.opr.at(-1)?.[1]}, USD/MYR ${mm.series.usdmyr.at(-1)?.join(" ")}`);
summary(`Malaysia: MGS curve ${curve.date}, 10Y ${t10?.[1]}%, ${tenors[10]?.length} days of history, ${bonds.length} bonds`);
