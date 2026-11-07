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
// The page's flows charts and back-test read the daily build (`daily`, see buildDaily); the weekly build feeds the
// US Treasury transmission study.
// Usage: node scripts/fetch-korea-flows.mjs. Anything that fails keeps the previous series.
import { readFileSync, writeFileSync } from "node:fs";
import { finalQuoteHistory, kst, addDays } from "./kofia.mjs";
import { study } from "./ust-transmission.mjs";

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

// US Treasury daily par yields (official, ~15:30 New York), 2Y and 10Y. Yahoo ^TNX as a 10Y fallback.
async function treasury(from) {
  const out = { u2: [], u10: [] }, y0 = +from.slice(0, 4), y1 = new Date().getUTCFullYear();
  for (let yr = y0; yr <= y1; yr++) {
    const r = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`Treasury ${yr} HTTP ${r.status}`);
    const lines = (await r.text()).trim().split(/\r?\n/), head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const i2 = head.indexOf("2 Yr"), i10 = head.indexOf("10 Yr");
    for (const ln of lines.slice(1)) {
      const f = ln.split(","), [mm, dd, yy] = f[0].replace(/"/g, "").split("/"), d = `${yy}-${mm}-${dd}`;
      if (d < from) continue;
      if (+f[i2] > 0) out.u2.push([d, +f[i2]]); if (+f[i10] > 0) out.u10.push([d, +f[i10]]);
    }
  }
  for (const k of ["u2", "u10"]) out[k].sort((a, b) => a[0].localeCompare(b[0]));
  if (out.u10.length < 200) throw new Error("short Treasury history");
  return out;
}
async function yahooTnx(from) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?period1=${Math.floor(Date.parse(from) / 1000)}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  const j = await r.json(), q = j.chart.result[0];
  return q.timestamp.map((t, i) => [new Date((t - 4 * 3600) * 1000).toISOString().slice(0, 10), q.indicators.quote[0].close[i]]).filter(([, v]) => v > 0).map(([d, v]) => [d, +v.toFixed(3)]);
}

async function fetchRaw() {
  const p = prev?.raw || {};
  const tryGet = async (name, fn) => { try { const v = await fn(); log(`${name}: ${v.length} weeks, last ${v.at(-1)[0]}`); return v; } catch (e) { log(`${name} failed (${e.message}); keeping previous`); return p[name] || []; } };
  return {
    kospi: await tryGet("kospi", async () => (await naver("KOSPI", "week", 260)).map(([d, c]) => [d, c])),
    kr10y: await tryGet("kr10y", async () => lastOfWeek((await finalQuoteHistory(["3013"], BEG, kst()))["3013"])),
    ...(await (async () => { // daily KTB 3Y/10Y (KOFIA) for the US Treasury transmission study
      try { const h = await finalQuoteHistory(["3000", "3013"], BEG, kst()); log(`daily KTB: ${h["3013"].length} days`); return { ktb3d: h["3000"], ktb10d: h["3013"] }; }
      catch (e) { log(`daily KTB failed (${e.message}); keeping previous`); return { ktb3d: p.ktb3d || [], ktb10d: p.ktb10d || [] }; }
    })()),
    ...(await (async () => {
      try { const t = await treasury(BEG); log(`UST: ${t.u10.length} days, last ${t.u10.at(-1)[0]}`); return { ust2d: t.u2, ust10d: t.u10 }; }
      catch (e) {
        log(`Treasury failed (${e.message}); trying Yahoo ^TNX`);
        try { const u = await yahooTnx(BEG); return { ust2d: p.ust2d || [], ust10d: u }; } catch (e2) { log(`Yahoo failed (${e2.message}); keeping previous`); return { ust2d: p.ust2d || [], ust10d: p.ust10d || [] }; }
      }
    })()),
    ...(await (async () => { // KOFIA freesis daily margin credit / deposits; the weekly series are their last day of each week
      const one = async (name, obj) => { try { const v = (await freesis(obj, BEG)).map((x) => [x.d, +(x.TMPV2 / 1e6).toFixed(2)]); if (v.length < 20) throw new Error("short"); log(`${name}D: ${v.length} days, last ${v.at(-1)[0]}`); return v; } catch (e) { log(`${name} failed (${e.message}); keeping previous`); return null; } };
      const m = await one("margin", "STATSCU0100000070BO"), d = await one("deposits", "STATSCU0100000060BO");
      return { margin: m ? lastOfWeek(m) : p.margin || [], marginD: m || p.marginD || [], deposits: d ? lastOfWeek(d) : p.deposits || [], depositsD: d || p.depositsD || [] };
    })()),
    bondEtf: await tryGet("bondEtf", async () => (await naver("439870", "week", 260)).map(([d, c, v]) => [d, c, +(c * v / 1e9).toFixed(2)])),
    eqEtfAmt: await tryGet("eqEtfAmt", async () => (await naver("069500", "week", 260)).map(([d, c, v]) => [d, +(c * v / 1e9).toFixed(2)])),
    // daily closes and turnover for the daily build (Naver day chart)
    kospiD: await tryGet("kospiD", async () => (await naver("KOSPI", "day", 1300)).map(([d, c]) => [d, c])),
    bondEtfD: await tryGet("bondEtfD", async () => (await naver("439870", "day", 1300)).map(([d, c, v]) => [d, c, +(c * v / 1e9).toFixed(2)])),
    eqEtfAmtD: await tryGet("eqEtfAmtD", async () => (await naver("069500", "day", 1300)).map(([d, c, v]) => [d, +(c * v / 1e9).toFixed(2)])),
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
  return { series, backtest: bt, curve, episodes, latest, W };
}

// ---------- daily build: same signal and back-test, every Seoul session ----------
// Windows are the weekly ones in trading days (4 weeks = 20, 26 weeks = 130, 52 weeks = 260), so the signal means the
// same thing, re-read after every KOFIA close. Margin credit is KOFIA's latest published balance on or before the day
// (it is reported with a lag, so nothing from the future leaks in). The US Treasury level is the last New York close
// strictly before the Seoul close. UST hedge: β = trailing 130-day OLS beta of the daily 10Y KTB change on the daily
// US 10Y change, known at the time.
const lastIdx = (sorted, d) => { let lo = 0, hi = sorted.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (sorted[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
function buildDaily(raw) {
  if (!raw.kospiD?.length || !raw.ktb10d?.length || !raw.marginD?.length) throw new Error("no daily inputs yet");
  const csi = new Map(raw.kospiD.map((r) => [r[0], r[1]])), bE = new Map(raw.bondEtfD.map((r) => [r[0], r])), eE = new Map(raw.eqEtfAmtD.map((r) => [r[0], r[1]]));
  const mg = raw.marginD.slice().sort((a, b) => a[0].localeCompare(b[0])), mgD = mg.map((r) => r[0]);
  const u10 = raw.ust10d.slice().sort((a, b) => a[0].localeCompare(b[0])), uD = u10.map((r) => r[0]);
  const D = [];
  for (const [d, y] of raw.ktb10d) {
    if (d < BEG || !csi.has(d) || !(y > 0)) continue;
    const im = lastIdx(mgD, d), iu = lastIdx(uD, d) - (uD[lastIdx(uD, d)] === d ? 1 : 0);
    const b = bE.get(d), e = eE.get(d), ust = iu >= 0 ? u10[iu][1] : null;
    D.push({ date: d, csi: csi.get(d), y10: y, margin: im >= 0 ? mg[im][1] : null, bpx: b ? b[1] : null, share: b && e != null && b[2] + e > 0 ? b[2] / (b[2] + e) : null, ust, sp: ust != null ? (y - ust) * 100 : null });
  }
  const L = 20, ZWIN = 260, ZMIN = 130, SHW = 130, SHMIN = 65, SH4 = 20, SH4MIN = 15, CW = 130, CMIN = 100, BW = 130, BMIN = 100, TH = 0.5, H = 20, AN = Math.sqrt(252);
  for (let i = 0; i < D.length; i++) {
    const w = D[i], p = D[i - L], q = D[i - 1];
    w.eq4 = p ? (w.csi / p.csi - 1) * 100 : null;
    w.dm4 = p?.margin && w.margin ? (w.margin / p.margin - 1) * 100 : null;
    w.dmAbs = q?.margin && w.margin ? w.margin - q.margin : null;
    w.dmAbs4 = p?.margin && w.margin ? w.margin - p.margin : null;
    const sh = D.slice(Math.max(0, i - SHW + 1), i + 1).map((x) => x.share).filter((x) => x != null);
    const sh4 = D.slice(Math.max(0, i - SH4 + 1), i + 1).map((x) => x.share).filter((x) => x != null);
    w.bsDev = sh.length >= SHMIN && sh4.length >= SH4MIN ? (mean(sh4) - mean(sh)) * 100 : null;
    w.dy4 = p ? (w.y10 - p.y10) * 100 : null;
    w.dy1 = q ? (w.y10 - q.y10) * 100 : null;
    w.du1 = q && q.ust != null && w.ust != null ? (w.ust - q.ust) * 100 : null;
    w.ret1 = q ? (w.csi / q.csi - 1) * 100 : null;
    const z = (field) => {
      const hist = D.slice(Math.max(0, i - ZWIN + 1), i + 1).map((x) => x[field]).filter((x) => x != null);
      if (hist.length < ZMIN || w[field] == null) return null;
      const s = sd(hist); return s ? (w[field] - mean(hist)) / s : 0;
    };
    const zs = [z("eq4"), z("dm4"), z("bsDev"), z("dy4")];
    w.z = zs.map((x) => r2(x));
    const parts = [zs[0] == null ? null : -zs[0], zs[1] == null ? null : -zs[1], zs[2], zs[3] == null ? null : -zs[3]].filter((x) => x != null);
    w.S = parts.length >= 3 ? mean(parts) : null;
    w.reg = w.S == null ? null : w.S >= TH ? 1 : w.S <= -TH ? -1 : 0;
    const win = D.slice(Math.max(1, i - CW + 1), i + 1).filter((x) => x.ret1 != null && x.dy1 != null);
    w.corr = win.length >= CMIN ? corr(win.map((x) => x.ret1), win.map((x) => x.dy1)) : null;
    const bw = D.slice(Math.max(1, i - BW + 1), i + 1).filter((x) => x.dy1 != null && x.du1 != null);
    if (bw.length >= BMIN) { const xs = bw.map((x) => x.du1), ys = bw.map((x) => x.dy1), mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0; for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; } w.beta = sxx ? sxy / sxx : null; } else w.beta = null;
  }
  let cumBp = 0, cumHold = 0, cumLong = 0, eq = 1, eqHold = 1, eqLong = 1, peak = 0, mdd = 0, peakEq = 1, mddEq = 0, pkH = 0, mddH = 0, pkL = 0, mddL = 0;
  const pnlLong = [], pnl = [], holdD = [], curve = [], stO = { 1: [], 0: [], [-1]: [] };
  const first = D.findIndex((w) => w.reg != null);
  for (let i = first; i >= 0 && i < D.length; i++) {
    const w = D[i], nx = D[i + 1];
    if (w.reg != null && D[i + H]) stO[w.reg].push((D[i + H].y10 - w.y10) * 100);
    if (!nx) continue;
    const pos = w.reg ?? 0, dyb = -(nx.y10 - w.y10) * 100, bp = pos * dyb, lpos = pos > 0 ? 1 : 0;
    cumBp += bp; cumHold += dyb; cumLong += lpos * dyb; pnl.push(bp); pnlLong.push(lpos * dyb); holdD.push(dyb);
    pkH = Math.max(pkH, cumHold); mddH = Math.min(mddH, cumHold - pkH); pkL = Math.max(pkL, cumLong); mddL = Math.min(mddL, cumLong - pkL);
    const er = w.bpx && nx.bpx ? nx.bpx / w.bpx - 1 : 0;
    eq *= 1 + pos * er; eqHold *= 1 + er; eqLong *= 1 + lpos * er;
    peak = Math.max(peak, cumBp); mdd = Math.min(mdd, cumBp - peak);
    peakEq = Math.max(peakEq, eq); mddEq = Math.min(mddEq, eq / peakEq - 1);
    curve.push([nx.date, r2(cumBp, 1), r2(cumHold, 1), r2(cumLong, 1), r2((eq - 1) * 100, 2), r2((eqHold - 1) * 100, 2), r2((eqLong - 1) * 100, 2), pos]);
  }
  const hit = (arr, wantNeg) => arr.length ? arr.filter((x) => (wantNeg ? x < 0 : x > 0)).length / arr.length : null;
  const shp = (a) => r2(a.length > 10 && sd(a) ? (mean(a) / sd(a)) * AN : null, 2);
  const bt = {
    horizonDays: H, threshold: TH, days: pnl.length, from: D[first]?.date, to: D.at(-1).date,
    rally: { n: stO[1].length, hit: r2(hit(stO[1], true), 3), avgFwdBp: r2(stO[1].length ? mean(stO[1]) : null, 1) },
    selloff: { n: stO[-1].length, hit: r2(hit(stO[-1], false), 3), avgFwdBp: r2(stO[-1].length ? mean(stO[-1]) : null, 1) },
    neutral: { n: stO[0].length, avgFwdBp: r2(stO[0].length ? mean(stO[0]) : null, 1) },
    allAvgFwdBp: r2(mean([...stO[1], ...stO[0], ...stO[-1]]), 1),
    cumBp: r2(cumBp, 1), holdBp: r2(cumHold, 1), longBp: r2(cumLong, 1), maxDdBp: r2(mdd, 1), holdMaxDdBp: r2(mddH, 1), longMaxDdBp: r2(mddL, 1),
    sharpe: shp(pnl), longSharpe: shp(pnlLong), holdSharpe: shp(holdD), volBp: r2(sd(pnl) * AN, 0),
    etfLongPct: r2((eqLong - 1) * 100, 2), etfStratPct: r2((eq - 1) * 100, 2), etfHoldPct: r2((eqHold - 1) * 100, 2), etfMaxDdPct: r2(mddEq * 100, 2),
    timeInMarket: r2(curve.filter((r) => r[7]).length / Math.max(1, curve.length), 3),
    curveCols: ["date", "strategyBp", "holdBp", "longFlatBp", "etfStrategyPct", "etfHoldPct", "etfLongFlatPct", "position"],
  };
  const hFirst = D.findIndex((w, i) => i >= first && w.reg != null && w.beta != null && w.ust != null);
  const hedgedCurve = [], hp = [], hDates = [], stH = { 1: [], [-1]: [] };
  let hc = 0, hl = 0, hpk = 0, hmdd = 0;
  for (let i = hFirst; i >= 0 && i < D.length - 1; i++) {
    const w = D[i], nx = D[i + 1], b = w.beta; if (b == null || nx.ust == null || w.ust == null) continue;
    const mv = ((nx.y10 - w.y10) - b * (nx.ust - w.ust)) * 100, pos = w.reg ?? 0;
    hc += -pos * mv; hl += -(pos > 0 ? 1 : 0) * mv; hp.push(-pos * mv); hDates.push(nx.date);
    hpk = Math.max(hpk, hc); hmdd = Math.min(hmdd, hc - hpk);
    hedgedCurve.push([nx.date, r2(hc, 1), r2(hl, 1)]);
    const f = D[i + H]; if (pos && f && f.ust != null) stH[pos].push(((f.y10 - w.y10) - b * (f.ust - w.ust)) * 100);
  }
  const split = "2024-09-01", sub = (pred) => { const p = hp.filter((_, k) => pred(hDates[k])), o = pnl.filter((_, k) => pred(curve[k][0])); return { days: p.length, hedged: { cumBp: r2(p.reduce((s, x) => s + x, 0), 1), sharpe: shp(p) }, outright: { cumBp: r2(o.reduce((s, x) => s + x, 0), 1), sharpe: shp(o) } }; };
  const hedged = {
    from: D[hFirst]?.date, cumBp: r2(hc, 1), longBp: r2(hl, 1), sharpe: shp(hp), maxDdBp: r2(hmdd, 1), volBp: r2(sd(hp) * AN, 0), beta: r2(D.at(-1).beta, 2),
    rally: { n: stH[1].length, hit: r2(hit(stH[1], true), 3) }, selloff: { n: stH[-1].length, hit: r2(hit(stH[-1], false), 3) },
    periods: [{ label: `${(D[hFirst]?.date || "").slice(0, 7)} – 2024-08`, ...sub((d) => d < split) }, { label: `2024-09 – ${D.at(-1).date.slice(0, 7)}`, ...sub((d) => d >= split) }],
  };
  const episodes = [];
  for (let i = 0; i < D.length; i++) {
    const r = D[i].reg; if (!r || (i && D[i - 1].reg === r)) continue;
    let j = i; while (D[j + 1]?.reg === r) j++;
    const end = D[Math.min(j + H, D.length - 1)];
    episodes.push({ from: D[i].date, to: D[j].date, type: r > 0 ? "rally" : "selloff", days: j - i + 1, y0: D[i].y10, y1: end.y10, bp: r2((end.y10 - D[i].y10) * 100, 1), open: !D[j + 1] || j + H >= D.length });
  }
  const series = D.map((w) => [w.date, w.csi, w.y10, w.margin, r2(w.dmAbs, 2), r2(w.share != null ? w.share * 100 : null, 1), r2(w.S, 2), w.reg, r2(w.corr, 2), w.bpx, r2(w.eq4, 2), r2(w.dm4, 2), r2(w.bsDev, 2), r2(w.dy4, 1), w.z, w.ust, r2(w.beta, 2)]);
  const last = D.at(-1), ago = (n) => D[D.length - 1 - n], yr = D.slice(-252);
  const dep = raw.depositsD?.length ? raw.depositsD : raw.deposits, idp = lastIdx(dep.map((r) => r[0]), last.date), dp20 = idp >= 20 ? dep[idp - 20] : null;
  const latest = {
    date: last.date, csi: last.csi, y10: last.y10, margin: last.margin, S: r2(last.S, 2), reg: last.reg, corr: r2(last.corr, 2),
    z: last.z, eq4: r2(last.eq4, 2), dmAbs4: r2(last.dmAbs4, 1), dm4: r2(last.dm4, 2), bsDev: r2(last.bsDev, 2), dy4: r2(last.dy4, 1),
    share: r2(last.share != null ? last.share * 100 : null, 1), S20ago: r2(ago(L)?.S, 2), S1ago: r2(ago(1)?.S, 2),
    deposits: idp >= 0 ? dep[idp][1] : null, deposits20: idp >= 0 && dp20 ? r2(dep[idp][1] - dp20[1], 2) : null,
    marginPeak: Math.max(...D.map((w) => w.margin || 0)), csiPeak1y: Math.max(...yr.map((w) => w.csi)), y10Low1y: Math.min(...yr.map((w) => w.y10)), y10High1y: Math.max(...yr.map((w) => w.y10)),
  };
  return {
    cols: ["date", "kospi", "kr10y", "marginTn", "marginDayChgTn", "bondEtfSharePct", "signal", "regime", "corr130d", "etf439870", "eq20dPct", "margin20dPct", "bondShareDevPp", "dy20dBp", "z", "ust10y", "betaUst130d"],
    method: { window: "20-day changes; z-scores vs trailing 260 sessions (min 130); bond ETF share 20-day avg minus 130-day avg; thresholds ±0.5; hit rates over the next 20 sessions; UST hedge β = trailing 130-day daily beta", components: ["KOSPI 20-day return (inverted)", "Margin credit 20-day % change (inverted)", "30Y KTB ETF turnover share: 20-day avg minus 130-day avg", "10Y KTB yield 20-day change (inverted)"] },
    series, backtest: bt, curve, hedged, hedgedCurve, episodes, latest,
  };
}

// ---------- run ----------
const raw = process.argv.includes("--raw") ? prev.raw : await fetchRaw(); // --raw: rebuild from the committed raw series, no network
for (const k of ["kospi", "kr10y", "margin"]) if (!raw[k]?.length) { log(`missing ${k}; leaving ${OUT} unchanged`); process.exit(0); }
const b = build(raw);
// investor deposits alongside (not in the signal: a level, read in the commentary)
const dep = new Map(raw.deposits.map((r) => [weekKey(r[0]), r[1]]));
b.latest.deposits = dep.get(weekKey(b.latest.date)) ?? raw.deposits.at(-1)?.[1] ?? null;
const d4 = raw.deposits.at(-5)?.[1]; b.latest.deposits4 = b.latest.deposits != null && d4 ? +(b.latest.deposits - d4).toFixed(2) : null;
// US Treasury transmission study and the UST-hedged back-test (scripts/ust-transmission.mjs)
let ust = null;
try { ust = study(raw, b.W); } catch (e) { log(`UST study failed: ${e.message}`); }
if (ust) b.series.forEach((row, i) => row.push(b.W[i].ust ?? null, r2(b.W[i].beta, 2), r2(b.W[i].sp, 1)));
delete b.W;
let daily = null;
try { daily = buildDaily(raw); log(`daily: ${daily.series.length} sessions to ${daily.latest.date}; signal ${daily.latest.S} (${daily.latest.reg}); outright ${daily.backtest.cumBp}bp Sharpe ${daily.backtest.sharpe} · hedged ${daily.hedged.cumBp}bp Sharpe ${daily.hedged.sharpe}; ${daily.episodes.length} episodes`); }
catch (e) { log(`daily build failed (${e.message}); keeping previous`); daily = prev?.daily || null; }
const out = {
  ust,
  updated: Math.floor(Date.now() / 1000),
  src: "US Treasury daily par yields (2Y, 10Y; home.treasury.gov). Naver Finance: KOSPI and ETF weekly charts (KODEX 국고채30년액티브 439870, KODEX 200 069500). KOFIA: 10Y KTB final quote; freesis margin credit balance (신용공여 잔고) and investor deposits (투자자예탁금). Weekly, last trading day of each week.",
  cols: ["date", "kospi", "kr10y", "marginTn", "marginWkChgTn", "bondEtfSharePct", "signal", "regime", "corr26w", "etf439870", "eq4Pct", "margin4Pct", "bondShareDevPp", "dy4Bp", "z", "ust10y", "betaUst26w", "ktbUstSpreadBp"],
  method: {
    window: "4-week changes; z-scores vs trailing 52 weeks (min 26); thresholds ±0.5",
    components: ["KOSPI 4-week return (inverted)", "Margin credit 4-week % change (inverted)", "30Y KTB ETF turnover share: 4-week avg minus 26-week avg", "10Y KTB yield 4-week change (inverted)"],
  },
  ...b,
  daily,
  notes: prev?.notes || null,
  events: prev?.events || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${b.series.length} weeks to ${b.latest.date}; signal ${b.latest.S} (${b.latest.reg}); backtest`, JSON.stringify(b.backtest));
