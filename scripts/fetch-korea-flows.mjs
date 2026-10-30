// Korea tab, "KOSPI ↔ KTB rotation": weekly fund-flow proxies between Korean equities and KTBs, plus a
// back-tested Bond Rotation Signal that flags when KTBs are likely to rally or sell off. Same method as the
// China panel (scripts/fetch-china-flows.mjs), with Korean inputs:
//  - KOSPI close (Naver Finance weekly chart)
//  - 10Y KTB yield (KOFIA final quote, 15:30 KST)
//  - Margin credit balance (신용공여 잔고, KOFIA freesis), KRW tn: leveraged retail equity money
//  - Investor deposits at brokers (투자자예탁금, KOFIA freesis), KRW tn: cash waiting to buy stocks
//  - 30Y KTB ETF (KODEX 국고채30년액티브, 439870) price and turnover, and KOSPI 200 ETF (KODEX 200, 069500)
//    turnover, KRW bn: the bond ETF's share of the two
// Signal (positive = bond-bullish), recomputed every week using only data up to that week:
//   S = mean( −z(KOSPI 4-week return), −z(4-week % change in margin credit),
//             +z(bond ETF turnover share, 4-week avg minus 26-week avg), −z(4-week change in 10Y yield) )
// Usage: node scripts/fetch-korea-flows.mjs. Anything that fails keeps the previous series.
import { readFileSync, writeFileSync } from "node:fs";
import { finalQuoteHistory, kst, addDays } from "./kofia.mjs";

const OUT = "data/korea-flows.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BEG = "2022-09-01";
const log = (...a) => console.log(...a);
let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

function weekKey(d) { const t = new Date(d + "T12:00:00Z"), dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return t.toISOString().slice(0, 10); }
const lastOfWeek = (rows) => { const wk = new Map(); for (const r of rows) wk.set(weekKey(r[0]), r); return [...wk.values()]; };
// Naver Finance chart (XML): item data="YYYYMMDD|open|high|low|close|volume"
async function naver(sym, tf, count) {
  const r = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${sym}&timeframe=${tf}&count=${count}&requestType=0`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = new TextDecoder("euc-kr").decode(await r.arrayBuffer());
  const out = [...t.matchAll(/data="(\d{8})\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^"]*)"/g)].map((m) => [`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, +m[5], +m[6]]);
  if (out.length < 20) throw new Error("short history for " + sym);
  return out.filter(([d]) => d >= BEG);
}
// KOFIA freesis statistics (daily rows, newest first)
async function freesis(obj, from) {
  const body = { dmSearch: { tmpV40: "1000000", tmpV41: "1", tmpV1: "D", tmpV45: from.replace(/-/g, ""), tmpV46: kst().replace(/-/g, ""), OBJ_NM: obj } };
  const r = await fetch("https://freesis.kofia.or.kr/meta/getMetaDataList.do", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json; charset=UTF-8", Referer: "https://freesis.kofia.or.kr/" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.ds1 || []).map((x) => ({ ...x, d: `${x.TMPV1.slice(0, 4)}-${x.TMPV1.slice(4, 6)}-${x.TMPV1.slice(6)}` })).sort((a, b) => a.d.localeCompare(b.d));
}

async function fetchRaw() {
  const p = prev?.raw || {};
  const tryGet = async (name, fn) => { try { const v = await fn(); log(`${name}: ${v.length} weeks, last ${v.at(-1)[0]}`); return v; } catch (e) { log(`${name} failed (${e.message}); keeping previous`); return p[name] || []; } };
  return {
    kospi: await tryGet("kospi", async () => (await naver("KOSPI", "week", 260)).map(([d, c]) => [d, c])),
    kr10y: await tryGet("kr10y", async () => lastOfWeek((await finalQuoteHistory(["3013"], BEG, kst()))["3013"])),
    margin: await tryGet("margin", async () => lastOfWeek((await freesis("STATSCU0100000070BO", BEG)).map((x) => [x.d, +(x.TMPV2 / 1e6).toFixed(2)]))),
    deposits: await tryGet("deposits", async () => lastOfWeek((await freesis("STATSCU0100000060BO", BEG)).map((x) => [x.d, +(x.TMPV2 / 1e6).toFixed(2)]))),
    bondEtf: await tryGet("bondEtf", async () => (await naver("439870", "week", 260)).map(([d, c, v]) => [d, c, +(c * v / 1e9).toFixed(2)])),
    eqEtfAmt: await tryGet("eqEtfAmt", async () => (await naver("069500", "week", 260)).map(([d, c, v]) => [d, +(c * v / 1e9).toFixed(2)])),
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
  const C = byWeek(raw.kospi), Y = byWeek(raw.kr10y), M = byWeek(raw.margin), B = byWeek(raw.bondEtf), E = byWeek(raw.eqEtfAmt);
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
const raw = await fetchRaw();
for (const k of ["kospi", "kr10y", "margin"]) if (!raw[k]?.length) { log(`missing ${k}; leaving ${OUT} unchanged`); process.exit(0); }
const b = build(raw);
// investor deposits alongside (not in the signal: a level, read in the commentary)
const dep = new Map(raw.deposits.map((r) => [weekKey(r[0]), r[1]]));
b.latest.deposits = dep.get(weekKey(b.latest.date)) ?? raw.deposits.at(-1)?.[1] ?? null;
const d4 = raw.deposits.at(-5)?.[1]; b.latest.deposits4 = b.latest.deposits != null && d4 ? +(b.latest.deposits - d4).toFixed(2) : null;
const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "Naver Finance: KOSPI and ETF weekly charts (KODEX 국고채30년액티브 439870, KODEX 200 069500). KOFIA: 10Y KTB final quote; freesis margin credit balance (신용공여 잔고) and investor deposits (투자자예탁금). Weekly, last trading day of each week.",
  cols: ["date", "kospi", "kr10y", "marginTn", "marginWkChgTn", "bondEtfSharePct", "signal", "regime", "corr26w", "etf439870", "eq4Pct", "margin4Pct", "bondShareDevPp", "dy4Bp", "z"],
  method: {
    window: "4-week changes; z-scores vs trailing 52 weeks (min 26); thresholds ±0.5",
    components: ["KOSPI 4-week return (inverted)", "Margin credit 4-week % change (inverted)", "30Y KTB ETF turnover share: 4-week avg minus 26-week avg", "10Y KTB yield 4-week change (inverted)"],
  },
  ...b,
  notes: prev?.notes || null,
  events: prev?.events || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${b.series.length} weeks to ${b.latest.date}; signal ${b.latest.S} (${b.latest.reg}); backtest`, JSON.stringify(b.backtest));
