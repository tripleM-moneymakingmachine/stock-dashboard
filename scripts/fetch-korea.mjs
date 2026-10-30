// Korea tab data (data/korea.json), the Korean counterpart of data/china.json:
//  - KTB curve: KOFIA final-quote yields (최종호가수익률, 15:30 KST) for the 1/2/3/5/10/20/30/50Y Korea Treasury
//    Bond benchmarks, joined smoothly (monotone cubic) into a curve; below 1Y it runs to the 91-day MSB quote.
//  - Tenor history: one year of those daily closes.
//  - Bonds: every KTB seen trading over the counter in the last year (KOFIA daily OTC trade summary by bond, with
//    ISIN), today's KOFIA OTC weighted-average traded yield, and its spread to the KTB curve at its remaining term.
//  - Quasi-sovereign curves (`pb`): Bank of Korea Monetary Stabilisation Bonds (MSB, KOFIA 91-day / 1Y / 2Y quotes)
//    and three state policy banks (KDB, IBK, KEXIM). KOFIA quotes only a 1Y KDB rate, so the policy bank curves are
//    fitted by the dashboard: each issuer's OTC trades over the last three sessions are expressed as spreads to the
//    KTB curve, and a Nelson-Siegel spread curve (level + slope, τ = 2Y) is fitted by volume-weighted least squares
//    with outliers trimmed. Curve = KTB curve + fitted spread. The same fit for AAA bank debentures is `ncd`.
//  - Money market and credit (`mm`): KOFIA CD 91d, CP 91d, MSB 91d, KDB 1Y, KEPCO 3Y, corporate AA- and BBB- 3Y.
// Anything that fails keeps the previous file's values. Usage: node scripts/fetch-korea.mjs [--backfill N]
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { ITEMS, finalQuoteHistory, finalQuoteDay, otcDay, kst, addDays, num } from "./kofia.mjs";

const OUT = "data/korea.json", MASTER = "data/ktb-master.json";
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const r4 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(4));
const r1 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(1));
const today = kst();
const bi = process.argv.indexOf("--backfill"), BACKFILL = bi > 0 ? +process.argv[bi + 1] : 260;

let prev = {};
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
let master = { bonds: {} };
try { master = JSON.parse(readFileSync(MASTER, "utf8")); } catch { log("no ktb master yet"); }

// ---------- issuers ----------
const ISS = [
  { k: "ktb", short: "KTB", re: /^국고채|재정증권/ },
  { k: "msb", short: "MSB", re: /통안|통화안정/ },
  { k: "kdb", short: "KDB", name: "Korea Development Bank", kr: "산업금융채권", re: /산업금융|^산금/ },
  { k: "ibk", short: "IBK", name: "Industrial Bank of Korea", kr: "중소기업금융채권", re: /중소기업금융|^중기/ },
  { k: "kexim", short: "KEXIM", name: "Export-Import Bank of Korea", kr: "수출입금융채권", re: /수출입/ },
];
const issuerOf = (t) => { for (const i of ISS) if (i.re.test(t.name)) return i.k; if (t.kind === "은행채" && /^AAA/.test(t.rating)) return "bank"; return null; };
// remaining term "YYMMDD" (years, months, days) → years and maturity date
function remain(rem, d) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(rem || ""); if (!m) return null;
  const [y, mo, dd] = [+m[1], +m[2], +m[3]];
  const t = new Date(d + "T12:00:00Z"); t.setUTCFullYear(t.getUTCFullYear() + y); t.setUTCMonth(t.getUTCMonth() + mo); t.setUTCDate(t.getUTCDate() + dd);
  return { ttm: y + mo / 12 + dd / 365.25, mat: t.toISOString().slice(0, 10) };
}
const ttmOn = (mat, d) => (Date.parse(mat) - Date.parse(d)) / (365.25 * 864e5);
// KTB / MSB names carry the coupon: 국고채권03000-4212(12-5) → 3.000%, issue number 12-5
function nameInfo(name, k) {
  const o = {};
  const c = /(\d{5})-(\d{4})/.exec(name);
  if (c && (k === "ktb" || k === "msb")) { const v = +c[1] / 1000; if (v > 0 && v < 20) o.coupon = v; }
  const p = /\((\d{2}-\d{1,2})\)/.exec(name); if (p && k === "ktb") o.code = p[1];
  o.type = /물가/.test(name) ? "Inflation-linked" : /재정증권|할인/.test(name) ? "Discount" : /녹색|그린|ESG/.test(name) ? "Green" : "Coupon";
  return o;
}

// ---------- curve maths ----------
// monotone cubic (Fritsch–Carlson) through sorted points
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
const KTB_T = [1, 2, 3, 5, 10, 20, 30, 50];
const ktbCode = Object.fromEntries(Object.entries(ITEMS).filter(([, [k]]) => k === "ktb").map(([c, [, t]]) => [t, c]));
// KTB curve function for one date from the tenor maps (null if fewer than 6 tenors that day)
function ktbFn(H, d) {
  const pts = KTB_T.map((t) => [t, H[ktbCode[t]]?.get(d)]).filter(([, y]) => y != null);
  if (pts.length < 6) return null;
  const msb = H[3015]?.get(d); if (msb != null) pts.unshift([0.25, msb]);
  return mono(pts);
}
// Nelson-Siegel spread fit: s(t) = a + b·(1 − e^(−t/τ))/(t/τ), weighted least squares, trimmed
const nsF = (t, tau = 2) => { const x = Math.max(t, 0.02) / tau; return (1 - Math.exp(-x)) / x; };
function fitSpread(obs) { // obs: [{t, s (bp), w}]
  if (obs.length < 3) return null;
  const solve = (o) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const { t, s, w } of o) { const f = nsF(t); sw += w; sx += w * f; sy += w * s; sxx += w * f * f; sxy += w * f * s; }
    const det = sw * sxx - sx * sx, span = Math.max(...o.map((q) => q.t)) - Math.min(...o.map((q) => q.t));
    if (o.length < 5 || span < 1.5 || Math.abs(det) < 1e-9) { const a = sy / sw; return { a, b: 0 }; } // flat spread
    const b = (sw * sxy - sx * sy) / det, a = (sy - b * sx) / sw;
    return { a, b: Math.max(-150, Math.min(150, b)) };
  };
  let o = obs, p = solve(o);
  for (let k = 0; k < 2; k++) {
    const res = o.map((q) => Math.abs(q.s - (p.a + p.b * nsF(q.t))));
    const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)] || 0;
    const keep = o.filter((q, i) => res[i] <= Math.max(6, 3 * med));
    if (keep.length < 3 || keep.length === o.length) break;
    o = keep; p = solve(o);
  }
  return { ...p, n: o.length, tmax: Math.max(...o.map((q) => q.t)) };
}

// ---------- 1. KOFIA final-quote history (five years for the flows panel, one year kept here) ----------
const codes = Object.keys(ITEMS);
let H = {}; // code -> Map(date -> yield)
try {
  const hist = await finalQuoteHistory(codes, addDays(today, -370), today);
  for (const c of codes) H[c] = new Map(hist[c]);
  log(`KOFIA history: ${hist[3013].length} days of 10Y KTB, last ${hist[3013].at(-1)?.[0]}`);
} catch (e) {
  log(`KOFIA history failed (${e.message}); keeping previous file`);
  const p = prev.tenors || {}; for (const [t, c] of Object.entries(ktbCode)) H[c] = new Map(p[t] || []);
  for (const [k, o] of Object.entries(prev.mm?.series || {})) H[k] = new Map(o);
}
// today's quote (also covers the case where the history call lags the day's 15:30 close)
try {
  const day = await finalQuoteDay(today);
  for (const [c, v] of Object.entries(day)) if (v.pm != null) { H[c] ||= new Map(); H[c].set(today, v.pm); }
  if (Object.keys(day).length) log(`KOFIA final quotes today: ${Object.keys(day).length} items`);
} catch (e) { log(`KOFIA day quotes: ${e.message}`); }
const dates = [...(H[3013]?.keys() || [])].sort();
if (!dates.length) { log("no KTB data at all; leaving file unchanged"); process.exit(0); }
const lastD = dates.at(-1);
const tenors = {}; for (const t of KTB_T) tenors[t] = [...H[ktbCode[t]].entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, y]) => [d, r4(y)]);
const fNow = ktbFn(H, lastD);
const curvePts = []; for (let t = 0.25; t <= 50.0001; t += t < 2 ? 0.05 : t < 10 ? 0.1 : 0.25) curvePts.push([+t.toFixed(2), r4(fNow(t))]);
const curve = { date: lastD, pts: curvePts };

// ---------- 2. OTC trades: today + backfill of the fitted curves ----------
const tradeDates = dates.slice(-BACKFILL); // business days (from the KTB quotes)
const have = new Set((prev.pb?.kdb?.tenors?.[1] || []).map(([d]) => d));
const need = tradeDates.filter((d) => !have.has(d) || d >= addDays(lastD, -5)); // always redo the last week
const otc = new Map(); // date -> trades
async function pool(list, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const x = list[i++]; await fn(x); } })); }
// fitting a day needs that day and the two before it
const fetchSet = new Set(); for (const d of need) { const i = tradeDates.indexOf(d); for (let j = Math.max(0, i - 2); j <= i; j++) fetchSet.add(tradeDates[j]); }
// the register (every bond seen trading in the last year) needs the whole year once
const fullReg = !Object.keys(master.bonds || {}).length;
if (fullReg) tradeDates.forEach((d) => fetchSet.add(d));
let fails = 0;
await pool([...fetchSet].sort(), 4, async (d) => { try { otc.set(d, await otcDay(d)); } catch (e) { fails++; } });
log(`OTC trade days fetched: ${otc.size} (${fails} failed)`);

// register
const reg = master.bonds || {};
for (const [d, rows] of [...otc.entries()].sort()) for (const t of rows) {
  const k = issuerOf(t); if (!k || k === "bank") continue;
  const rm = remain(t.rem, d); if (!rm) continue;
  const ni = nameInfo(t.name, k);
  const o = reg[t.isin] || {};
  reg[t.isin] = { k, isin: t.isin, name: t.name, code: ni.code || o.code || null, coupon: ni.coupon ?? o.coupon ?? null, type: ni.type, mat: o.mat || rm.mat, first: o.first && o.first < d ? o.first : d, last: !o.last || d > o.last ? d : o.last };
}
for (const [isin, b] of Object.entries(reg)) if (b.mat < today) delete reg[isin];
writeFileSync(MASTER, JSON.stringify({ updated: Math.floor(Date.now() / 1000), src: "KOFIA OTC trade summaries by bond (일자별 거래현황): every KTB, MSB, KDB, IBK and KEXIM bond seen trading over the counter in the last year", bonds: reg }));
log(`register: ${Object.keys(reg).length} bonds`);

// fitted spread curves per day
const FIT = ["kdb", "ibk", "kexim", "bank"];
const FIT_T = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20];
const fitHist = {}; for (const k of FIT) { fitHist[k] = {}; const pt = k === "bank" ? prev.ncd?.tenors : prev.pb?.[k]?.tenors; for (const t of FIT_T) fitHist[k][t] = new Map(pt?.[t] || []); }
const fitNow = {};
for (const d of need) {
  const i = tradeDates.indexOf(d), win = tradeDates.slice(Math.max(0, i - 2), i + 1);
  if (!win.every((x) => otc.has(x))) continue;
  const obs = Object.fromEntries(FIT.map((k) => [k, []]));
  for (const wd of win) {
    const f = ktbFn(H, wd); if (!f) continue;
    for (const t of otc.get(wd)) {
      const k = issuerOf(t); if (!obs[k]) continue;
      const rm = remain(t.rem, wd); if (!rm || rm.ttm < 0.08 || t.y == null) continue;
      const s = (t.y - f(rm.ttm)) * 100; if (!isFinite(s) || Math.abs(s) > 250) continue;
      obs[k].push({ t: rm.ttm, s, w: Math.max(1, Math.sqrt((t.amt || t.vol || 1) / 1e5)) * (wd === d ? 1.5 : 1) });
    }
  }
  const f = ktbFn(H, d); if (!f) continue;
  for (const k of FIT) {
    const p = fitSpread(obs[k]); if (!p) continue;
    const top = Math.min(20, Math.max(3, p.tmax + 1));
    for (const t of FIT_T) if (t <= top + 1e-9) fitHist[k][t].set(d, r4(f(t) + (p.a + p.b * nsF(t)) / 100));
    if (d === lastD || !fitNow[k] || d > fitNow[k].d) fitNow[k] = { d, ...p, top };
  }
}
const toSer = (m) => [...m.entries()].filter(([d]) => d >= tradeDates[0]).sort((a, b) => a[0].localeCompare(b[0]));

// ---------- 3. today's bonds ----------
const tradeDay = [...otc.keys()].filter((d) => otc.get(d).length).sort().at(-1) || prev.tradeDay || null;
const prevTD = tradeDay ? [...otc.keys()].filter((d) => d < tradeDay && otc.get(d).length).sort().at(-1) : null;
const todayT = tradeDay ? otc.get(tradeDay) || [] : [];
const prevY = new Map((prevTD ? otc.get(prevTD) : []).map((t) => [t.isin, t.y]));
const fT = ktbFn(H, tradeDay) || fNow;
const curveAt = (k, ttm) => {
  if (k === "ktb") return fT(ttm);
  if (k === "msb") { const p = [[0.25, H[3015]?.get(tradeDay)], [1, H[3016]?.get(tradeDay)], [2, H[3003]?.get(tradeDay)]].filter(([, y]) => y != null); return p.length >= 2 ? mono(p)(ttm) : null; }
  const fit = fitNow[k]; return fit ? fT(ttm) + (fit.a + fit.b * nsF(ttm)) / 100 : null;
};
const traded = {}; // issuer -> [bond]
for (const t of todayT) {
  const k = issuerOf(t); if (!k) continue;
  const rm = remain(t.rem, tradeDay); if (!rm || rm.ttm <= 0) continue;
  const ni = nameInfo(t.name, k), c = curveAt(k, rm.ttm), p0 = prevY.get(t.isin);
  (traded[k] ||= []).push({ code: ni.code || t.isin.slice(2, 11), isin: t.isin, name: t.name, coupon: ni.coupon ?? reg[t.isin]?.coupon ?? null, type: ni.type, mat: reg[t.isin]?.mat || rm.mat, ttm: r4(rm.ttm), last: r4(t.y), wavg: r4(t.y), hi: r4(t.hi), lo: r4(t.lo), px: t.px, vol: t.vol, amt: t.amt, n: t.n, rating: t.rating || null, chg: p0 != null ? r1((t.y - p0) * 100) : null, curve: r4(c), vs: c != null ? r1((t.y - c) * 100) : null });
}
// KTB register rows (untraded bonds show the curve only)
const ktbTr = new Map((traded.ktb || []).map((b) => [b.isin, b]));
const bonds = Object.values(reg).filter((b) => b.k === "ktb").map((b) => {
  const ttm = ttmOn(b.mat, tradeDay || lastD), t = ktbTr.get(b.isin);
  return { code: b.code || b.isin.slice(2, 11), isin: b.isin, name: b.name, type: b.type, coupon: b.coupon, issue: b.first <= tradeDates[0] ? null : b.first, mat: b.mat, ttm: r4(ttm), curve: r4(fT(ttm)), last: t?.last ?? null, wavg: t?.wavg ?? null, px: t?.px ?? null, vol: t?.vol ?? null, chg: t?.chg ?? null, vs: t?.vs ?? null, n: t?.n ?? null };
}).filter((b) => b.ttm > 0).sort((a, b) => a.ttm - b.ttm);

// ---------- 4. quasi-sovereign curves ----------
const ser = (c) => toSer(H[c] || new Map()).map(([d, y]) => [d, r4(y)]);
const msbCurve = (() => { const p = [[0.25, H[3015]?.get(lastD)], [1, H[3016]?.get(lastD)], [2, H[3003]?.get(lastD)]].filter(([, y]) => y != null); if (p.length < 2) return null; const f = mono(p); const pts = []; for (let t = 0.25; t <= 2.0001; t += 0.05) pts.push([+t.toFixed(2), r4(f(t))]); return { date: lastD, pts }; })();
const regList = (k) => Object.values(reg).filter((b) => b.k === k).map((b) => { const ttm = ttmOn(b.mat, tradeDay || lastD); return { code: b.code || b.isin.slice(2, 11), name: b.name, isin: b.isin, coupon: b.coupon, issue: b.first <= tradeDates[0] ? null : b.first, mat: b.mat, ttm: r4(ttm), curve: r4(curveAt(k, ttm)) }; }).filter((b) => b.ttm > 0);
const pb = {
  msb: { short: "MSB", name: "Bank of Korea Monetary Stabilisation Bonds", kr: "통화안정증권", src: "KOFIA final quotes: MSB 91-day, 1Y and 2Y", fitted: false, curve: msbCurve, tenors: { 0.25: ser(3015), 1: ser(3016), 2: ser(3003) }, bonds: traded.msb || [], reg: regList("msb") },
};
for (const i of ISS.filter((x) => ["kdb", "ibk", "kexim"].includes(x.k))) {
  const fit = fitNow[i.k], f = fNow;
  const pts = []; if (fit) for (let t = 0.25; t <= fit.top + 1e-9; t += t < 2 ? 0.05 : 0.1) pts.push([+t.toFixed(2), r4(f(t) + (fit.a + fit.b * nsF(t)) / 100)]);
  const tn = {}; for (const t of FIT_T) { const s = toSer(fitHist[i.k][t]); if (s.length) tn[t] = s; }
  pb[i.k] = { short: i.short, name: i.name, kr: i.kr, fitted: true, fit: fit ? { date: fit.d, levelBp: r1(fit.a), slopeBp: r1(fit.b), n: fit.n } : null, curve: pts.length ? { date: fit.d, pts } : null, tenors: tn, bonds: traded[i.k] || [], reg: regList(i.k) };
}
// KOFIA's own 1Y KDB quote, to check the fitted curve against
if (pb.kdb) pb.kdb.kofia1y = ser(3004);
// AAA bank debentures (the NCD equivalent: banks' own short-term funding paper)
const bankFit = fitNow.bank;
const ncd = (() => {
  const pts = []; if (bankFit) for (let t = 0.25; t <= bankFit.top + 1e-9; t += t < 2 ? 0.05 : 0.1) pts.push([+t.toFixed(2), r4(fNow(t) + (bankFit.a + bankFit.b * nsF(t)) / 100)]);
  const tn = {}; for (const t of FIT_T) { const s = toSer(fitHist.bank[t]); if (s.length) tn[t] = s; }
  const bs = (traded.bank || []).map((b) => ({ ...b, bank: b.name.replace(/\s.*$/, "").replace(/\d.*$/, ""), est: false, code: b.isin.slice(2, 11) }));
  return { name: "AAA bank debentures", kr: "은행채 (AAA)", fitted: true, fit: bankFit ? { date: bankFit.d, levelBp: r1(bankFit.a), slopeBp: r1(bankFit.b), n: bankFit.n } : null, curve: pts.length ? { date: bankFit.d, pts } : null, tenors: tn, bonds: bs, tradeDay };
})();

// ---------- 5. money market and credit ----------
const MM = { cd: 4000, cp: 5000, msb91: 3015, kdb1y: 3004, kepco3y: 3002, aa3y: 3009, bbb3y: 3010, nhb5y: 3008, ktb3y: 3000 };
const mm = { series: Object.fromEntries(Object.entries(MM).map(([k, c]) => [k, ser(c)])) };

const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "KOFIA (Korea Financial Investment Association) bond information service: final-quote yields at 15:30 KST and daily OTC trades by bond",
  curve, tenors, bonds,
  tradeDay, prevTradeDay: prevTD, tradeTime: tradeDay ? `${tradeDay} 15:30` : null,
  masterUpdated: Math.floor(Date.now() / 1000),
  pb, ncd, mm,
  pbTradeDay: tradeDay, pbTradeTime: tradeDay ? `${tradeDay} 15:30` : null,
  pbSrc: "MSB: KOFIA final quotes. KDB, IBK, KEXIM and AAA bank debentures: KTB curve plus a Nelson-Siegel spread fitted to the last three sessions' KOFIA OTC trades",
  counts: Object.fromEntries(Object.entries(traded).map(([k, v]) => [k, v.length])),
};
writeFileSync(OUT, JSON.stringify(out));
const msg = `Korea: KTB curve ${lastD}, 10Y ${tenors[10].at(-1)?.[1]}; ${bonds.length} KTBs on register (${bonds.filter((b) => b.last != null).length} traded ${tradeDay}); fits: ${FIT.map((k) => `${k} ${fitNow[k] ? `${r1(fitNow[k].a)}bp/${fitNow[k].n}` : "–"}`).join(", ")}`;
log(msg); summary(msg);
