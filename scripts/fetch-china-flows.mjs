// China tab, "Bond ↔ equity rotation": weekly fund-flow proxies between China equities and CGBs, plus a
// back-tested Bond Rotation Signal that flags when bonds are likely to rally or sell off.
//
// Inputs (weekly, last trading day of each week, from Eastmoney's public kline / datacenter APIs):
//  - CSI 300 index close (000300)
//  - China 10Y government bond yield (CN10Y, interbank)
//  - Margin financing balance, Shanghai + Shenzhen (融资余额, RPTA_RZRQ_LSHJ), RMB bn: net leveraged equity buying
//  - 30Y CGB ETF 511090 price and weekly turnover, and CSI 300 ETF 510300 weekly turnover, RMB bn:
//    the bond ETF's share of the two (where trading money is going)
//
// Signal (positive = bond-bullish), recomputed every week using only data up to that week:
//   S = mean( −z(CSI 300 4-week return), −z(4-week % change in margin balance),
//             +z(bond ETF turnover share, 4-week avg minus 26-week avg), −z(4-week change in 10Y yield) )
//   each z is against its own trailing 52 weeks (needs 26). S ≥ +0.5 → "Bond rally", S ≤ −0.5 → "Bond sell-off".
// Back-test: position at week t (+1 long duration / 0 / −1 short duration) earns the 10Y yield change of week t+1
// (in bp, sign flipped), and the 511090 ETF return; hit rates use the next 4 weeks' 10Y change. No look-ahead.
//
// Usage: node scripts/fetch-china-flows.mjs            (fetch, then build data/china-flows.json)
//        node scripts/fetch-china-flows.mjs --raw f.json   (build from a saved raw file, no network)
// Anything that fails to fetch keeps the series from the previous data/china-flows.json.
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "data/china-flows.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const H = { "User-Agent": UA, Referer: "https://quote.eastmoney.com/", Accept: "application/json, text/plain, */*" };
const BEG = "20230501";
const log = (...a) => console.log(...a);

let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

async function getJSON(url, ms = 30000) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// weekly kline: fields = list of kline field indexes after the date (f53 close, f57 turnover)
async function kline(secid, fields) {
  const u = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=102&fqt=1&beg=${BEG}&end=20500101&fields1=f1&fields2=f51,${fields.join(",")}`;
  const j = await getJSON(u);
  const k = j?.data?.klines;
  if (!k?.length) throw new Error("no klines for " + secid);
  return k.map((s) => { const p = s.split(","); return [p[0], ...p.slice(1).map(Number)]; });
}
async function margin() {
  const rows = [];
  for (let page = 1; page <= 5; page++) {
    const u = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=DIM_DATE,RZYE&sortColumns=DIM_DATE&sortTypes=1&pageNumber=${page}&pageSize=500&filter=(DIM_DATE%3E%3D%27${BEG.slice(0, 4)}-${BEG.slice(4, 6)}-${BEG.slice(6)}%27)&source=WEB&client=WEB`;
    const j = await getJSON(u);
    const d = j?.result?.data || [];
    rows.push(...d.map((x) => [x.DIM_DATE.slice(0, 10), +(x.RZYE / 1e9).toFixed(1)]));
    if (page >= (j?.result?.pages || 1)) break;
  }
  if (rows.length < 100) throw new Error("short margin history");
  // last trading day of each week
  const wk = new Map();
  for (const r of rows) wk.set(weekKey(r[0]), r);
  return [...wk.values()];
}

function weekKey(d) { // Monday of the ISO week, as YYYY-MM-DD
  const t = new Date(d + "T12:00:00Z"), dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

async function fetchRaw() {
  const p = prev?.raw || {};
  const tryGet = async (name, fn) => { try { const v = await fn(); log(`${name}: ${v.length} weeks, last ${v.at(-1)[0]}`); return v; } catch (e) { log(`${name} failed (${e.message}); keeping previous`); return p[name] || []; } };
  return {
    csi300: await tryGet("csi300", async () => (await kline("1.000300", ["f53"]))),
    cn10y: await tryGet("cn10y", async () => (await kline("171.CN10Y", ["f53"]))),
    margin: await tryGet("margin", margin),
    etf511090: await tryGet("etf511090", async () => (await kline("1.511090", ["f53", "f57"])).map(([d, c, a]) => [d, c, +(a / 1e9).toFixed(2)])),
    etf510300amt: await tryGet("etf510300amt", async () => (await kline("1.510300", ["f57"])).map(([d, a]) => [d, +(a / 1e9).toFixed(2)])),
  };
}

// ---------- build ----------
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(n));
function corr(a, b) {
  const ma = mean(a), mb = mean(b); let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sa && sb ? sab / Math.sqrt(sa * sb) : null;
}

function build(raw) {
  const byWeek = (rows) => { const m = new Map(); for (const r of rows) m.set(weekKey(r[0]), r); return m; };
  const C = byWeek(raw.csi300), Y = byWeek(raw.cn10y), M = byWeek(raw.margin), B = byWeek(raw.etf511090), E = byWeek(raw.etf510300amt);
  const keys = [...new Set([...C.keys()].filter((k) => Y.has(k)))].sort();
  let lastM = null;
  const W = keys.map((k) => {
    const c = C.get(k), y = Y.get(k), m = M.get(k), b = B.get(k), e = E.get(k);
    if (m) lastM = m[1];
    const date = c[0] > y[0] ? c[0] : y[0];
    const share = b && e && b[2] + e[1] > 0 ? b[2] / (b[2] + e[1]) : null;
    return { k, date, csi: c[1], y10: y[1], margin: m ? m[1] : lastM, bpx: b ? b[1] : null, bamt: b ? b[2] : null, eamt: e ? e[1] : null, share };
  });

  const L = 4, ZWIN = 52, ZMIN = 26, TH = 0.5;
  const feat = { eq: [], mg: [], bs: [], dy: [] };
  for (let i = 0; i < W.length; i++) {
    const w = W[i], p = W[i - L];
    w.eq4 = p ? (w.csi / p.csi - 1) * 100 : null;
    w.dm4 = p && p.margin && w.margin ? (w.margin / p.margin - 1) * 100 : null;
    w.dmAbs = W[i - 1]?.margin && w.margin ? w.margin - W[i - 1].margin : null;
    w.dmAbs4 = p?.margin && w.margin ? w.margin - p.margin : null;
    const sh = W.slice(Math.max(0, i - 25), i + 1).map((x) => x.share).filter((x) => x != null);
    const sh4 = W.slice(Math.max(0, i - 3), i + 1).map((x) => x.share).filter((x) => x != null);
    w.bsDev = sh.length >= 13 && sh4.length >= 3 ? (mean(sh4) - mean(sh)) * 100 : null;
    w.dy4 = p ? (w.y10 - p.y10) * 100 : null;
    w.dy1 = W[i - 1] ? (w.y10 - W[i - 1].y10) * 100 : null;
    w.ret1 = W[i - 1] ? (w.csi / W[i - 1].csi - 1) * 100 : null;
    // trailing z-scores (data up to and including week i only)
    const z = (field) => {
      const hist = W.slice(Math.max(0, i - ZWIN + 1), i + 1).map((x) => x[field]).filter((x) => x != null);
      if (hist.length < ZMIN || w[field] == null) return null;
      const s = sd(hist); return s ? (w[field] - mean(hist)) / s : 0;
    };
    const zs = [z("eq4"), z("dm4"), z("bsDev"), z("dy4")];
    w.z = zs.map((x) => r2(x));
    const parts = [zs[0] == null ? null : -zs[0], zs[1] == null ? null : -zs[1], zs[2], zs[3] == null ? null : -zs[3]].filter((x) => x != null);
    w.S = parts.length >= 3 ? mean(parts) : null;
    w.reg = w.S == null ? null : w.S >= TH ? 1 : w.S <= -TH ? -1 : 0;
    // 26-week rolling correlation of weekly CSI 300 return vs weekly 10Y change
    const win = W.slice(Math.max(1, i - 25), i + 1).filter((x) => x.ret1 != null && x.dy1 != null);
    w.corr = win.length >= 20 ? corr(win.map((x) => x.ret1), win.map((x) => x.dy1)) : null;
  }

  // ---------- back-test ----------
  const H = 4;
  let cumBp = 0, cumHold = 0, cumLong = 0, eq = 1, eqHold = 1, eqLong = 1, peak = 0, mdd = 0, peakEq = 1, mddEq = 0, pkH = 0, mddH = 0, pkL = 0, mddL = 0;
  const pnlLong = [];
  const pnl = [], curve = [];
  const st = { 1: [], 0: [], [-1]: [] };
  let first = null;
  for (let i = 0; i < W.length; i++) {
    const w = W[i], nx = W[i + 1];
    if (w.reg != null && first == null) first = i;
    if (w.reg != null && W[i + H]) st[w.reg].push((W[i + H].y10 - w.y10) * 100);
    if (first == null || !nx) continue;
    const pos = W[i].reg ?? 0;
    const bp = -pos * (nx.y10 - w.y10) * 100;
    const dyb = -(nx.y10 - w.y10) * 100, lpos = pos > 0 ? 1 : 0;
    cumBp += bp; cumHold += dyb; cumLong += lpos * dyb; pnl.push(bp); pnlLong.push(lpos * dyb);
    pkH = Math.max(pkH, cumHold); mddH = Math.min(mddH, cumHold - pkH); pkL = Math.max(pkL, cumLong); mddL = Math.min(mddL, cumLong - pkL);
    const er = w.bpx && nx.bpx ? nx.bpx / w.bpx - 1 : 0;
    eq *= 1 + pos * er; eqHold *= 1 + er; eqLong *= 1 + lpos * er;
    peak = Math.max(peak, cumBp); mdd = Math.min(mdd, cumBp - peak);
    peakEq = Math.max(peakEq, eq); mddEq = Math.min(mddEq, eq / peakEq - 1);
    curve.push([nx.date, r2(cumBp, 1), r2(cumHold, 1), r2(cumLong, 1), r2((eq - 1) * 100, 2), r2((eqHold - 1) * 100, 2), r2((eqLong - 1) * 100, 2), pos]);
  }
  const hit = (arr, wantNeg) => arr.length ? arr.filter((x) => (wantNeg ? x < 0 : x > 0)).length / arr.length : null;
  // episodes: consecutive weeks in the same non-neutral regime
  const episodes = [];
  for (let i = 0; i < W.length; i++) {
    const r = W[i].reg; if (!r) continue;
    if (i && W[i - 1].reg === r) continue;
    let j = i; while (W[j + 1]?.reg === r) j++;
    const end = W[Math.min(j + H, W.length - 1)];
    episodes.push({ from: W[i].date, to: W[j].date, type: r > 0 ? "rally" : "selloff", weeks: j - i + 1, y0: W[i].y10, y1: end.y10, bp: r2((end.y10 - W[i].y10) * 100, 1), open: !W[j + 1] || j + H >= W.length });
  }
  const bt = {
    horizonWeeks: H, threshold: TH, weeks: pnl.length, from: W[first]?.date, to: W.at(-1).date,
    rally: { n: st[1].length, hit: r2(hit(st[1], true), 3), avgFwdBp: r2(st[1].length ? mean(st[1]) : null, 1) },
    selloff: { n: st[-1].length, hit: r2(hit(st[-1], false), 3), avgFwdBp: r2(st[-1].length ? mean(st[-1]) : null, 1) },
    neutral: { n: st[0].length, avgFwdBp: r2(st[0].length ? mean(st[0]) : null, 1) },
    allAvgFwdBp: r2(mean([...st[1], ...st[0], ...st[-1]]), 1),
    cumBp: r2(cumBp, 1), holdBp: r2(cumHold, 1), longBp: r2(cumLong, 1), maxDdBp: r2(mdd, 1), holdMaxDdBp: r2(mddH, 1), longMaxDdBp: r2(mddL, 1),
    longSharpe: r2(pnlLong.length > 10 && sd(pnlLong) ? (mean(pnlLong) / sd(pnlLong)) * Math.sqrt(52) : null, 2), etfLongPct: r2((eqLong - 1) * 100, 2),
    sharpe: r2(pnl.length > 10 && sd(pnl) ? (mean(pnl) / sd(pnl)) * Math.sqrt(52) : null, 2),
    holdSharpe: null,
    etfStratPct: r2((eq - 1) * 100, 2), etfHoldPct: r2((eqHold - 1) * 100, 2), etfMaxDdPct: r2(mddEq * 100, 2),
    timeInMarket: r2(W.slice(first, -1).filter((w) => w.reg).length / Math.max(1, W.length - 1 - first), 3),
  };
  const holdW = W.slice(first + 1).map((w, i) => -(w.y10 - W[first + i].y10) * 100);
  bt.holdSharpe = r2(holdW.length > 10 && sd(holdW) ? (mean(holdW) / sd(holdW)) * Math.sqrt(52) : null, 2);

  const series = W.map((w) => [w.date, w.csi, w.y10, w.margin, r2(w.dmAbs, 1), r2(w.share != null ? w.share * 100 : null, 1), r2(w.S, 2), w.reg, r2(w.corr, 2), w.bpx, r2(w.eq4, 2), r2(w.dm4, 2), r2(w.bsDev, 2), r2(w.dy4, 1), w.z]);
  const last = W.at(-1);
  const ago = (n) => W[W.length - 1 - n];
  const latest = {
    date: last.date, csi: last.csi, y10: last.y10, margin: last.margin, S: r2(last.S, 2), reg: last.reg, corr: r2(last.corr, 2),
    z: last.z, eq4: r2(last.eq4, 2), dmAbs4: r2(last.dmAbs4, 1), dm4: r2(last.dm4, 2), bsDev: r2(last.bsDev, 2), dy4: r2(last.dy4, 1),
    share: r2(last.share * 100, 1), S4ago: r2(ago(4)?.S, 2),
    marginPeak: Math.max(...W.map((w) => w.margin || 0)), marginPeakDate: W.reduce((a, w) => ((w.margin || 0) > (a.margin || 0) ? w : a)).date,
    csiPeak52: Math.max(...W.slice(-52).map((w) => w.csi)), y10Low52: Math.min(...W.slice(-52).map((w) => w.y10)), y10High52: Math.max(...W.slice(-52).map((w) => w.y10)),
  };
  bt.curveCols = ["date", "strategyBp", "holdBp", "longFlatBp", "etfStrategyPct", "etfHoldPct", "etfLongFlatPct", "position"];
  return { series, backtest: bt, curve, episodes, latest };
}

// ---------- run ----------
const ri = process.argv.indexOf("--raw");
const raw = ri > 0 ? JSON.parse(readFileSync(process.argv[ri + 1], "utf8")) : await fetchRaw();
for (const k of ["csi300", "cn10y", "margin"]) if (!raw[k]?.length) { log(`missing ${k}; leaving ${OUT} unchanged`); process.exit(0); }
const b = build(raw);
const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "Eastmoney: CSI 300 index (000300), China 10Y government bond yield (CN10Y), Shanghai + Shenzhen margin financing balance (融资余额), 30Y CGB ETF 511090 and CSI 300 ETF 510300 weekly turnover. Weekly, last trading day of each week.",
  cols: ["date", "csi300", "cn10y", "marginBn", "marginWkChgBn", "bondEtfSharePct", "signal", "regime", "corr26w", "etf511090", "eq4Pct", "margin4Pct", "bondShareDevPp", "dy4Bp", "z"],
  method: {
    window: "4-week changes; z-scores vs trailing 52 weeks (min 26); thresholds ±0.5",
    components: ["CSI 300 4-week return (inverted)", "Margin balance 4-week % change (inverted)", "Bond ETF turnover share: 4-week avg minus 26-week avg", "10Y yield 4-week change (inverted)"],
  },
  ...b,
  notes: prev?.notes || null,
  events: prev?.events || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${b.series.length} weeks to ${b.latest.date}; signal ${b.latest.S} (${b.latest.reg}); backtest`, JSON.stringify(b.backtest));
