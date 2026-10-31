// Indonesia tab, "JCI ↔ INDOGB flows": weekly foreign-flow proxies between Indonesian equities, the rupiah and
// government bonds (INDOGB), plus a back-tested Bond Flow Signal that flags when INDOGBs are likely to rally or sell
// off. Built on the Korea rotation panel (scripts/fetch-korea-flows.mjs), with one deliberate change of sign.
//
// Why the sign changes. Korea's panel follows a domestic rotation: retail money leaves bonds when KOSPI runs and
// comes back when it cracks, so stocks and bonds move against each other. Indonesia is driven by foreign money
// instead (foreigners own a large share of the free float of both stocks and SBN, and the rupiah is the channel), so
// stocks, the rupiah and bonds tend to sell off and recover together. The live signal is set on that view before
// looking at any back-test; the Korea-style rotation is kept as a variant so the two can be compared honestly.
//
// Inputs (weekly, last trading day of each week):
//  - JCI (IDX Composite, Yahoo ^JKSE)
//  - USD/IDR (Yahoo IDR=X): the foreign-flow channel
//  - 10Y INDOGB yield: PHEI IGSYC 10Y from data/indonesia.json, CNBC benchmark 10Y before the first PHEI day
//  - US Treasury 2Y / 10Y par yields (home.treasury.gov), for the INDOGB − UST spread and the transmission study
// Signal (positive = bond-bullish), walk-forward, z-scores against the trailing 52 weeks (min 26):
//   S = mean( +z(JCI 4-week return), −z(USD/IDR 4-week % change), −z(10Y 4-week change),
//             +z(INDOGB − UST 10Y spread minus its 26-week average) )
// Usage: node scripts/fetch-indonesia-flows.mjs [--raw]. Anything that fails keeps the previous series.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { study } from "./ust-transmission.mjs";

const OUT = "data/indonesia-flows.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BEG = "2021-06-01";
const log = (...a) => console.log(...a);
let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

function weekKey(d) { const t = new Date(d + "T12:00:00Z"), dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return t.toISOString().slice(0, 10); }
const lastOfWeek = (rows) => { const wk = new Map(); for (const r of rows) wk.set(weekKey(r[0]), r); return [...wk.values()]; };

async function yahoo(sym, tzHours) { // daily closes since BEG, dated in the market's own time zone
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${Math.floor(Date.parse(BEG) / 1000)}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const q = (await r.json()).chart.result[0], c = q.indicators.quote[0].close, v = q.indicators.quote[0].volume || [];
  const out = q.timestamp.map((t, i) => [new Date((t + tzHours * 3600) * 1000).toISOString().slice(0, 10), c[i], v[i] || 0]).filter(([d, x]) => x > 0 && ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()));
  if (out.length < 200) throw new Error("short history for " + sym);
  return out;
}
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

async function fetchRaw() {
  const p = prev?.raw || {};
  const tryGet = async (name, fn) => { try { const v = await fn(); log(`${name}: ${v.length} rows, last ${v.at(-1)[0]}`); return v; } catch (e) { log(`${name} failed (${e.message}); keeping previous`); return p[name] || []; } };
  // INDOGB daily yields from the main Indonesia file (PHEI IGSYC, CNBC before the first PHEI day)
  let id = null; try { id = JSON.parse(readFileSync("data/indonesia.json", "utf8")); } catch {}
  const t10 = (id?.tenors?.["10"] || []).filter(([d]) => d >= BEG), t15 = (id?.tenors?.["15"] || []).filter(([d]) => d >= BEG);
  log(`INDOGB from data/indonesia.json: 10Y ${t10.length} days, 15Y ${t15.length} days`);
  const jciD = await tryGet("jciD", async () => (await yahoo("^JKSE", 7)).map(([d, c, v]) => [d, +c.toFixed(2), v]));
  const idrD = await tryGet("idrD", async () => (await yahoo("IDR=X", 0)).map(([d, c]) => [d, +c.toFixed(1)]));
  const ust = await (async () => {
    try { const t = await treasury(BEG); log(`UST: ${t.u10.length} days, last ${t.u10.at(-1)[0]}`); return { ust2d: t.u2, ust10d: t.u10 }; }
    catch (e) { log(`Treasury failed (${e.message}); keeping previous`); return { ust2d: p.ust2d || [], ust10d: p.ust10d || [] }; }
  })();
  return {
    jciD, idrD, id10d: t10.length > 200 ? t10 : p.id10d || t10, id15d: t15.length > 200 ? t15 : p.id15d || t15, ...ust,
    jci: lastOfWeek(jciD).map(([d, c]) => [d, c]), idr: lastOfWeek(idrD), id10: lastOfWeek(t10.length > 200 ? t10 : p.id10d || t10),
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
const lastBefore = (sorted, d) => { let lo = 0, hi = sorted.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (sorted[m] < d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };

function build(raw) {
  const byWeek = (rows) => { const m = new Map(); for (const r of rows) m.set(weekKey(r[0]), r); return m; };
  const C = byWeek(raw.jci), Y = byWeek(raw.id10), X = byWeek(raw.idr);
  const u10 = new Map(raw.ust10d), ud = [...u10.keys()].sort();
  const keys = [...C.keys()].filter((k) => Y.has(k)).sort();
  let lastX = null;
  const W = keys.map((k) => {
    const c = C.get(k), y = Y.get(k), x = X.get(k);
    if (x) lastX = x[1];
    const date = c[0] > y[0] ? c[0] : y[0];
    const iu = lastBefore(ud, date); const ust = iu >= 0 ? u10.get(ud[iu]) : null; // last New York close before the Jakarta close
    return { k, date, csi: c[1], y10: y[1], fx: x ? x[1] : lastX, ustW: ust, spW: ust != null ? (y[1] - ust) * 100 : null };
  });

  const L = 4, ZWIN = 52, ZMIN = 26, TH = 0.5;
  let tr = 100;
  for (let i = 0; i < W.length; i++) {
    const w = W[i], p = W[i - L], q = W[i - 1];
    w.eq4 = p ? (w.csi / p.csi - 1) * 100 : null;
    w.fx4 = p && p.fx && w.fx ? (w.fx / p.fx - 1) * 100 : null;
    w.fx1 = q && q.fx && w.fx ? (w.fx / q.fx - 1) * 100 : null;
    w.dy4 = p ? (w.y10 - p.y10) * 100 : null;
    w.dy1 = q ? (w.y10 - q.y10) * 100 : null;
    w.ret1 = q ? (w.csi / q.csi - 1) * 100 : null;
    const sp26 = W.slice(Math.max(0, i - 25), i + 1).map((x) => x.spW).filter((x) => x != null);
    w.spDev = sp26.length >= 13 && w.spW != null ? w.spW - mean(sp26) : null;
    // synthetic 10Y INDOGB total-return index (local currency): carry minus modified duration × yield change
    if (q) { const dur = 7.0; tr *= 1 + q.y10 / 100 / 52 - dur * (w.y10 - q.y10) / 100; }
    w.bpx = r2(tr, 3);
    const z = (field) => {
      const hist = W.slice(Math.max(0, i - ZWIN + 1), i + 1).map((x) => x[field]).filter((x) => x != null);
      if (hist.length < ZMIN || w[field] == null) return null;
      const s = sd(hist); return s ? (w[field] - mean(hist)) / s : 0;
    };
    const zs = [z("eq4"), z("fx4"), z("dy4"), z("spDev")];
    w.z = zs.map((x) => r2(x));
    const parts = [zs[0], zs[1] == null ? null : -zs[1], zs[2] == null ? null : -zs[2], zs[3]].filter((x) => x != null);
    w.S = parts.length >= 3 ? mean(parts) : null;
    w.reg = w.S == null ? null : w.S >= TH ? 1 : w.S <= -TH ? -1 : 0;
    const win = W.slice(Math.max(1, i - 25), i + 1).filter((x) => x.ret1 != null && x.dy1 != null);
    w.corr = win.length >= 20 ? corr(win.map((x) => x.ret1), win.map((x) => x.dy1)) : null;
  }

  // ---------- back-test (same rules as the Korea panel) ----------
  const H = 4;
  let cumBp = 0, cumHold = 0, cumLong = 0, eq = 1, eqHold = 1, eqLong = 1, peak = 0, mdd = 0, peakEq = 1, mddEq = 0, pkH = 0, mddH = 0, pkL = 0, mddL = 0;
  const pnlLong = [], pnl = [], curve = [], st = { 1: [], 0: [], [-1]: [] };
  let first = null;
  for (let i = 0; i < W.length; i++) {
    const w = W[i], nx = W[i + 1];
    if (w.reg != null && first == null) first = i;
    if (w.reg != null && W[i + H]) st[w.reg].push((W[i + H].y10 - w.y10) * 100);
    if (first == null || !nx) continue;
    const pos = W[i].reg ?? 0, dyb = -(nx.y10 - w.y10) * 100, bp = pos * dyb, lpos = pos > 0 ? 1 : 0;
    cumBp += bp; cumHold += dyb; cumLong += lpos * dyb; pnl.push(bp); pnlLong.push(lpos * dyb);
    pkH = Math.max(pkH, cumHold); mddH = Math.min(mddH, cumHold - pkH); pkL = Math.max(pkL, cumLong); mddL = Math.min(mddL, cumLong - pkL);
    const er = w.bpx && nx.bpx ? nx.bpx / w.bpx - 1 : 0;
    eq *= 1 + pos * er; eqHold *= 1 + er; eqLong *= 1 + lpos * er;
    peak = Math.max(peak, cumBp); mdd = Math.min(mdd, cumBp - peak);
    peakEq = Math.max(peakEq, eq); mddEq = Math.min(mddEq, eq / peakEq - 1);
    curve.push([nx.date, r2(cumBp, 1), r2(cumHold, 1), r2(cumLong, 1), r2((eq - 1) * 100, 2), r2((eqHold - 1) * 100, 2), r2((eqLong - 1) * 100, 2), pos]);
  }
  const hit = (arr, wantNeg) => arr.length ? arr.filter((x) => (wantNeg ? x < 0 : x > 0)).length / arr.length : null;
  const episodes = [];
  for (let i = 0; i < W.length; i++) {
    const r = W[i].reg; if (!r || (i && W[i - 1].reg === r)) continue;
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
    sharpe: r2(pnl.length > 10 && sd(pnl) ? (mean(pnl) / sd(pnl)) * Math.sqrt(52) : null, 2), holdSharpe: null,
    etfStratPct: r2((eq - 1) * 100, 2), etfHoldPct: r2((eqHold - 1) * 100, 2), etfMaxDdPct: r2(mddEq * 100, 2),
    timeInMarket: r2(W.slice(first, -1).filter((w) => w.reg).length / Math.max(1, W.length - 1 - first), 3),
  };
  const holdW = W.slice(first + 1).map((w, i) => -(w.y10 - W[first + i].y10) * 100);
  bt.holdSharpe = r2(holdW.length > 10 && sd(holdW) ? (mean(holdW) / sd(holdW)) * Math.sqrt(52) : null, 2);
  bt.curveCols = ["date", "strategyBp", "holdBp", "longFlatBp", "tr10yStrategyPct", "tr10yHoldPct", "tr10yLongFlatPct", "position"];

  // columns kept in the Korea panel's order so the page code carries over; Indonesian meaning in `cols`
  const series = W.map((w) => [w.date, w.csi, w.y10, w.fx, r2(w.fx1, 2), r2(w.spW, 1), r2(w.S, 2), w.reg, r2(w.corr, 2), w.bpx, r2(w.eq4, 2), r2(w.fx4, 2), r2(w.spDev, 1), r2(w.dy4, 1), w.z]);
  const last = W.at(-1), ago = (n) => W[W.length - 1 - n];
  const latest = {
    date: last.date, csi: last.csi, y10: last.y10, fx: last.fx, S: r2(last.S, 2), reg: last.reg, corr: r2(last.corr, 2),
    z: last.z, eq4: r2(last.eq4, 2), fx4: r2(last.fx4, 2), dy4: r2(last.dy4, 1), sp: r2(last.spW, 1), spDev: r2(last.spDev, 1), S4ago: r2(ago(4)?.S, 2),
    fxPeak: Math.max(...W.map((w) => w.fx || 0)), fxPeakDate: W.reduce((a, w) => ((w.fx || 0) > (a.fx || 0) ? w : a)).date,
    csiPeak52: Math.max(...W.slice(-52).map((w) => w.csi)), y10Low52: Math.min(...W.slice(-52).map((w) => w.y10)), y10High52: Math.max(...W.slice(-52).map((w) => w.y10)),
  };
  return { series, backtest: bt, curve, episodes, latest, W };
}

// ---------- run ----------
const raw = process.argv.includes("--raw") ? prev.raw : await fetchRaw();
for (const k of ["jci", "id10", "idr"]) if (!raw[k]?.length) { log(`missing ${k}; leaving ${OUT} unchanged`); process.exit(0); }
const b = build(raw);
// US Treasury transmission study with the Indonesian recipe (study() reads ktb10d / ktb3d: here INDOGB 10Y / 15Y)
const SPECS = [
  { k: "S0", name: "Live signal: JCI, rupiah, INDOGB 10Y trend, INDOGB–UST spread", c: [["eq4", 1], ["fx4", -1], ["dy4", -1], ["spDev", 1]], live: true },
  { k: "S1", name: "Live signal + US 10Y 4-week trend", c: [["eq4", 1], ["fx4", -1], ["dy4", -1], ["spDev", 1], ["du4", -1]] },
  { k: "S2", name: "US 10Y trend in place of the INDOGB trend", c: [["eq4", 1], ["fx4", -1], ["du4", -1], ["spDev", 1]] },
  { k: "S3", name: "Korea-style rotation (JCI inverted: stocks down = bonds up)", c: [["eq4", -1], ["fx4", -1], ["dy4", -1], ["spDev", 1]] },
  { k: "S4", name: "US 10Y trend alone", c: [["du4", -1]] },
  { k: "S5", name: "Rupiah trend alone", c: [["fx4", -1]] },
];
let ust = null;
try {
  ust = study({ ktb10d: raw.id10d, ktb3d: raw.id15d, ust10d: raw.ust10d, ust2d: raw.ust2d }, b.W, { specs: SPECS, split: "2024-09-01", method: "Overnight = New York closes strictly before each Jakarta close (New York shuts at about 04:00–05:00 Jakarta). Hedged = INDOGB 10Y minus β × US 10Y, β the trailing 26-week weekly beta known at the time. All variants walk-forward, z-scores vs trailing 52 weeks, thresholds ±0.5, hit rates over the next 4 weeks. The 'Beta 3Y' slot carries the INDOGB 15Y." });
} catch (e) { log(`UST study failed: ${e.message}`); }
if (ust) b.series.forEach((row, i) => row.push(b.W[i].ust ?? null, r2(b.W[i].beta, 2), r2(b.W[i].sp, 1)));
delete b.W;
const out = {
  ust,
  updated: Math.floor(Date.now() / 1000),
  src: "Yahoo Finance: IDX Composite (^JKSE) and USD/IDR (IDR=X) daily closes. INDOGB 10Y: PHEI IGSYC (CNBC benchmark 10Y before the first stored PHEI day). US Treasury daily par yields (2Y, 10Y; home.treasury.gov). Weekly, last trading day of each week.",
  cols: ["date", "jci", "id10y", "usdidr", "usdidrWkChgPct", "indogbUstSpreadBp", "signal", "regime", "corr26w", "tr10yIndex", "eq4Pct", "usdidr4Pct", "spreadDev26wBp", "dy4Bp", "z", "ust10y", "betaUst26w", "indogbUstSpreadBp2"],
  method: {
    window: "4-week changes; z-scores vs trailing 52 weeks (min 26); thresholds ±0.5",
    components: ["JCI 4-week return", "USD/IDR 4-week % change (inverted: a weaker rupiah is bond-bearish)", "10Y INDOGB yield 4-week change (inverted)", "INDOGB − UST 10Y spread vs its 26-week average (wide = cheap)"],
  },
  ...b,
  notes: prev?.notes || null,
  events: prev?.events || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${b.series.length} weeks to ${b.latest.date}; signal ${b.latest.S} (${b.latest.reg}); backtest`, JSON.stringify(b.backtest));
if (ust) for (const v of ust.variants) log(`  ${v.k} ${v.name}: outright ${v.outright.cumBp}bp Sharpe ${v.outright.sharpe} · hedged ${v.hedged.cumBp}bp Sharpe ${v.hedged.sharpe}`);
