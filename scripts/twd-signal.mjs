// USD/TWD equity-flow signal, built from the raw daily series in data/twd-flows.json (see fetch-twd-flows.mjs).
//
// Two readings, both positive = USD/TWD up (Taiwan dollar weaker):
//  Flow pressure (next 1–2 days): A = −mean( z(FINI net ÷ gross, 1 day), z(FINI net ÷ gross, 5 days) )
//    Foreign investors convert TWD around equity settlement (T+2), so heavy selling tends to weigh on the TWD for a day or two.
//    A ≥ +0.5 → "selling pressure" (long USD/TWD), A ≤ −0.5 → "buying pressure" (short USD/TWD).
//  Flow exhaustion (next ~month): C = mean( z(FINI net ÷ gross, 20 days), z(TAIEX 20-day return) )
//    After a month of heavy foreign buying and a strong TAIEX, the TWD has tended to give back gains (central bank smoothing,
//    exporter and life-insurer hedging), and the reverse after heavy selling. C ≥ +1 → "inflows stretched" (long USD/TWD),
//    C ≤ −1 → "outflows stretched" (short USD/TWD).
// Every z-score uses only the trailing 250 trading days up to that day (needs 120), so there is no look-ahead.
// Back-test over the last two years. USD/TWD is Yahoo's daily close, which falls after the Taipei close when TWSE posts
// the day's flows; "same day" enters at that close, "1 day late" waits one more close (the robustness check).

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r = (x, n = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(n));
const ZW = 250, ZMIN = 120, TH_A = 0.5, TH_C = 1.0;

function spearman(a, b) {
  const rank = (v) => { const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const rk = Array(v.length); o.forEach(([, i], j) => (rk[i] = j)); return rk; };
  const ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb);
  let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (ra[i] - ma) * (rb[i] - mb); sa += (ra[i] - ma) ** 2; sb += (rb[i] - mb) ** 2; }
  return sa && sb ? s / Math.sqrt(sa * sb) : null;
}

export function buildSignal(raw) {
  if (!raw?.fini?.length || raw.fini.length < ZMIN + 40) return {};
  const fxM = new Map(raw.usdtwd), fxD = raw.usdtwd.map((x) => x[0]);
  const fxOn = (d) => { if (fxM.has(d)) return fxM.get(d); let v = null; for (const k of fxD) { if (k > d) break; v = fxM.get(k); } return v; };
  const tw = new Map(raw.taiex), fi = new Map(raw.fini.map((x) => [x[0], x]));
  const days = raw.taiex.map((x) => x[0]).filter((d) => fi.has(d) && fxOn(d) != null);
  const W = days.map((d) => { const f = fi.get(d); return { d, fx: fxOn(d), tw: tw.get(d), net: f[3], gross: f[1] + f[2] }; });

  const sum = (i, n, k) => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += W[j][k]; return s; };
  for (let i = 0; i < W.length; i++) {
    const w = W[i];
    w.x1 = w.gross ? (w.net / w.gross) * 100 : null;
    w.x5 = i >= 4 ? (sum(i, 5, "net") / sum(i, 5, "gross")) * 100 : null;
    w.x20 = i >= 19 ? (sum(i, 20, "net") / sum(i, 20, "gross")) * 100 : null;
    w.eq20 = i >= 20 ? (w.tw / W[i - 20].tw - 1) * 100 : null;
    w.net20 = i >= 19 ? sum(i, 20, "net") : null;
    w.fx20 = i >= 20 ? (w.fx / W[i - 20].fx - 1) * 100 : null;
    const z = (k) => {
      const h = []; for (let j = Math.max(0, i - ZW + 1); j <= i; j++) if (W[j][k] != null) h.push(W[j][k]);
      if (h.length < ZMIN || w[k] == null) return null; const s = sd(h); return s ? (w[k] - mean(h)) / s : 0;
    };
    w.z = { x1: z("x1"), x5: z("x5"), x20: z("x20"), eq20: z("eq20") };
    w.A = w.z.x1 != null && w.z.x5 != null ? -(w.z.x1 + w.z.x5) / 2 : null;
    w.C = w.z.x20 != null && w.z.eq20 != null ? (w.z.x20 + w.z.eq20) / 2 : null;
    w.rA = w.A == null ? null : w.A >= TH_A ? 1 : w.A <= -TH_A ? -1 : 0;
    w.rC = w.C == null ? null : w.C >= TH_C ? 1 : w.C <= -TH_C ? -1 : 0;
  }

  // ---------- back-test, last two years ----------
  const last = W.at(-1).d, t0 = new Date(last + "T00:00:00Z"); t0.setUTCFullYear(t0.getUTCFullYear() - 2);
  const T0 = t0.toISOString().slice(0, 10);
  const i0 = W.findIndex((w) => w.d >= T0);
  const ret = (i, h) => (W[i + h] ? (W[i + h].fx / W[i].fx - 1) * 100 : null);
  const strat = (key, lag) => { // daily P&L in %: position from day t−lag earns the USD/TWD move from close t to close t+1
    const p = []; let cum = 0, pk = 0, dd = 0;
    for (let i = i0; i < W.length - 1; i++) {
      const pos = W[i - lag]?.[key] ?? 0, x = pos * ret(i, 1);
      p.push(x); cum += x; pk = Math.max(pk, cum); dd = Math.min(dd, cum - pk);
    }
    return { p, cum, dd };
  };
  const summ = (s) => ({ cumPct: r(s.cum), sharpe: r(s.p.length > 20 && sd(s.p) ? (mean(s.p) / sd(s.p)) * Math.sqrt(252) : null), maxDdPct: r(s.dd) });
  const side = (key, h, lag) => {
    const out = {};
    for (const [nm, sg] of [["long", 1], ["short", -1]]) {
      const f = []; for (let i = i0; i < W.length; i++) if (W[i][key] === sg) { const x = ret(i + lag, h); if (x != null) f.push(x); }
      out[nm] = { days: f.length, hit: r(f.length ? f.filter((x) => x * sg > 0).length / f.length : null, 3), avgPct: r(f.length ? mean(f) : null) };
    }
    return out;
  };
  const ic = (key, h, lag, step = 1) => {
    const a = [], b = []; for (let i = i0; i < W.length; i += step) { const x = ret(i + lag, h); if (W[i][key] != null && x != null) { a.push(W[i][key]); b.push(x); } }
    return { ic: r(spearman(a, b)), n: a.length };
  };
  for (const w of W) w.rCL = w.rC === 1 ? 1 : 0; // long-only version (the outflow side showed no edge)
  const sA0 = strat("rA", 0), sA1 = strat("rA", 1), sC1 = strat("rC", 1), sCL = strat("rCL", 1);
  const hold = { p: [], cum: 0, dd: 0 }; { let pk = 0; for (let i = i0; i < W.length - 1; i++) { const x = ret(i, 1); hold.p.push(x); hold.cum += x; pk = Math.max(pk, hold.cum); hold.dd = Math.min(hold.dd, hold.cum - pk); } }
  // contemporaneous link: 5-day FINI flow vs 5-day USD/TWD change (non-overlapping)
  const ca = [], cb = []; for (let i = Math.max(i0, 5); i < W.length; i += 5) if (W[i].x5 != null) { ca.push(W[i].x5); cb.push((W[i].fx / W[i - 5].fx - 1) * 100); }
  const pear = (a, b) => { const ma = mean(a), mb = mean(b); let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); };
  // flow-exhaustion episodes (consecutive days in the same non-zero regime), 20-day result from the day after the start
  const episodes = [];
  for (let i = i0; i < W.length; i++) {
    const g = W[i].rC; if (!g || W[i - 1]?.rC === g) continue;
    let j = i; while (W[j + 1]?.rC === g) j++;
    const f = ret(i + 1, 20);
    episodes.push({ from: W[i].d, to: W[j].d, side: g, days: j - i + 1, C: r(W[i].C), fx0: r(W[i + 1]?.fx ?? W[i].fx, 3), fwd20Pct: r(f), open: f == null });
  }
  const epSum = () => Object.fromEntries([["long", 1], ["short", -1]].map(([nm, g]) => {
    const e = episodes.filter((x) => x.side === g && x.fwd20Pct != null);
    return [nm, { n: e.length, right: e.filter((x) => x.fwd20Pct * g > 0).length, avgFwd20Pct: r(e.length ? mean(e.map((x) => x.fwd20Pct)) : null) }];
  }));
  const backtest = {
    from: W[i0].d, to: last, days: W.length - 1 - i0,
    contemp5dCorr: r(pear(ca, cb)),
    pressure: { threshold: TH_A, sameDay: summ(sA0), oneDayLate: summ(sA1), next2d: side("rA", 2, 0), next2dLate: side("rA", 2, 1), ic1: ic("A", 1, 0), ic1Late: ic("A", 1, 1), inMarket: r(W.slice(i0).filter((w) => w.rA).length / (W.length - i0), 3) },
    exhaustion: { threshold: TH_C, oneDayLate: summ(sC1), longOnly: summ(sCL), episodes: epSum(), next20d: side("rC", 20, 1), ic20: ic("C", 20, 1), ic20NonOverlap: ic("C", 20, 1, 20), inMarket: r(W.slice(i0).filter((w) => w.rC).length / (W.length - i0), 3) },
    hold: summ(hold),
  };
  // cumulative curves for the chart (% , additive)
  const curve = []; { let a = 0, b = 0, c = 0, l = 0, h = 0; for (let k = 0, i = i0; i < W.length - 1; i++, k++) { a += sA0.p[k]; b += sA1.p[k]; c += sC1.p[k]; l += sCL.p[k]; h += hold.p[k]; curve.push([W[i + 1].d, r(a), r(b), r(c), r(l), r(h)]); } }

  const series = W.map((w) => [w.d, w.fx, w.tw, r(w.net, 1), r(w.x5), r(w.x20), r(w.eq20), r(w.A), r(w.C), w.rA, w.rC, r(w.net20, 0)]);
  const L = W.at(-1);
  const latest = {
    date: L.d, fx: L.fx, taiex: L.tw, net: r(L.net, 1), x1: r(L.x1), x5: r(L.x5), x20: r(L.x20), eq20: r(L.eq20), net20: r(L.net20, 0), fx20: r(L.fx20),
    net60: r(W.slice(-60).reduce((s, w) => s + w.net, 0), 0), A: r(L.A), C: r(L.C), rA: L.rA, rC: L.rC,
    z: Object.fromEntries(Object.entries(L.z).map(([k, v]) => [k, r(v)])),
    A5ago: r(W.at(-6)?.A), C5ago: r(W.at(-6)?.C),
  };
  return {
    cols: ["date", "usdtwd", "taiex", "finiNetBn", "flow5Pct", "flow20Pct", "taiex20Pct", "pressure", "exhaustion", "regPressure", "regExhaustion", "finiNet20Bn"],
    method: { zWindow: ZW, zMin: ZMIN, pressureTh: TH_A, exhaustionTh: TH_C },
    series, backtest, curveCols: ["date", "pressureSameDay", "pressureLate", "exhaustion", "exhaustionLongOnly", "holdLong"], curve, episodes, latest,
  };
}
