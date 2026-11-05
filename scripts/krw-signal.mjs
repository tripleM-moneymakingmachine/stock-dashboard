// USD/KRW equity-flow signal, built from the raw daily series in data/krw-flows.json (see fetch-krw-flows.mjs).
// Same two readings as the USD/TWD panel (scripts/twd-signal.mjs), with Korean inputs and one extra layer:
//
//  Flow pressure (next 1–2 days): A = −mean( z(foreign net ÷ KOSPI turnover, 1 day), z(same, 5 days) )
//    KRX settles T+2 and foreigners buy or sell won around settlement, so heavy selling tends to weigh on the KRW for a
//    day or two. A ≥ +0.5 → "selling pressure" (long USD/KRW), A ≤ −0.5 → "buying pressure" (short USD/KRW).
//  Flow exhaustion (next ~month): C = mean( z(foreign net ÷ turnover, 20 days), z(KOSPI 20-day return) )
//    C ≥ +1 → "inflows stretched" (long USD/KRW), C ≤ −1 → "outflows stretched" (short USD/KRW).
//  Dollar & yuan model: daily USD/KRW % change regressed on the dollar index and USD/CNH % changes over the trailing
//    250 sessions, estimated only on data before the day (needs 120). The residual is the Korea-specific move. The
//    back-test reports each signal against the raw move and against that residual ("dollar-hedged"), which shows
//    whether foreign equity flows carry information beyond the global dollar and the yuan.
// Every z-score uses only the trailing 250 trading days up to that day (needs 120), so there is no look-ahead.
// USD/KRW is Yahoo's daily close, which falls after the 15:30 KST stock close when KRX posts the day's flows; "same day"
// enters at that close, "1 day late" waits one more close (the robustness check).

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r = (x, n = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(n));
const ZW = 250, ZMIN = 120, TH_A = 0.5, TH_C = 1.0, BW = 250, BMIN = 120;

function spearman(a, b) {
  const rank = (v) => { const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const rk = Array(v.length); o.forEach(([, i], j) => (rk[i] = j)); return rk; };
  const ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb);
  let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (ra[i] - ma) * (rb[i] - mb); sa += (ra[i] - ma) ** 2; sb += (rb[i] - mb) ** 2; }
  return sa && sb ? s / Math.sqrt(sa * sb) : null;
}
const pear = (a, b) => { if (a.length < 3) return null; const ma = mean(a), mb = mean(b); let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sa && sb ? s / Math.sqrt(sa * sb) : null; };
// OLS y = a + b1 x1 + b2 x2 → {b1, b2, r2}
function ols2(y, x1, x2) {
  const n = y.length, my = mean(y), m1 = mean(x1), m2 = mean(x2);
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x1[i] - m1, b = x2[i] - m2, c = y[i] - my; s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c; syy += c * c; }
  const det = s11 * s22 - s12 * s12; if (!det) return null;
  const b1 = (s22 * s1y - s12 * s2y) / det, b2 = (s11 * s2y - s12 * s1y) / det;
  return { b1, b2, a: my - b1 * m1 - b2 * m2, r2: syy ? (b1 * s1y + b2 * s2y) / syy : null };
}
const lookup = (rows) => { const m = new Map(rows || []), ks = (rows || []).map((x) => x[0]); return (d) => { if (m.has(d)) return m.get(d); let v = null; for (const k of ks) { if (k > d) break; v = m.get(k); } return v; }; };

export function buildSignal(raw) {
  if (!raw?.flows?.length || raw.flows.length < ZMIN + 40) return {};
  const fxOn = lookup(raw.usdkrw), dxOn = lookup(raw.dxy), cnOn = lookup(raw.usdcnh);
  const ks = new Map((raw.kospi || []).map((x) => [x[0], x])), fl = new Map(raw.flows.map((x) => [x[0], x]));
  const days = raw.kospi.map((x) => x[0]).filter((d) => fl.has(d) && fl.get(d)[1] != null && fxOn(d) != null);
  const W = days.map((d) => { const f = fl.get(d), k = ks.get(d); return { d, fx: fxOn(d), dx: dxOn(d), cn: cnOn(d), ks: k[1], tv: k[2], net: f[1], ret: f[2], inst: f[3], pen: f[4] }; });
  // turnover gaps (Yahoo fallback rows): use the trailing 20-session median
  for (let i = 0; i < W.length; i++) if (!(W[i].tv > 0)) { const h = W.slice(Math.max(0, i - 20), i).map((w) => w.tv).filter((x) => x > 0).sort((a, b) => a - b); W[i].tv = h.length ? h[h.length >> 1] : null; }
  // no turnover at all (KRX unavailable): scale by 20 × the trailing 60-session mean |foreign net| instead; z-scores
  // are scale-free, but the "% of turnover" figures are then not percentages, so the build flags it
  const proxy = W.every((w) => !(w.tv > 0));
  if (proxy) for (let i = 0; i < W.length; i++) { const h = W.slice(Math.max(0, i - 59), i + 1).map((w) => Math.abs(w.net)); W[i].tv = 20 * mean(h) || 1; }

  const sum = (i, n, k) => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += W[j][k] ?? 0; return s; };
  const pct = (a, b) => (a != null && b ? (a / b - 1) * 100 : null);
  for (let i = 0; i < W.length; i++) {
    const w = W[i], p = W[i - 1];
    w.x1 = w.tv ? (w.net / w.tv) * 100 : null;
    w.x5 = i >= 4 ? (sum(i, 5, "net") / sum(i, 5, "tv")) * 100 : null;
    w.x20 = i >= 19 ? (sum(i, 20, "net") / sum(i, 20, "tv")) * 100 : null;
    w.eq20 = i >= 20 ? pct(w.ks, W[i - 20].ks) : null;
    w.net20 = i >= 19 ? sum(i, 20, "net") : null;
    w.pen20 = i >= 19 ? sum(i, 20, "pen") : null;
    w.ret20 = i >= 19 ? sum(i, 20, "ret") : null;
    w.fx20 = i >= 20 ? pct(w.fx, W[i - 20].fx) : null;
    w.dx20 = i >= 20 ? pct(w.dx, W[i - 20].dx) : null;
    w.cn20 = i >= 20 ? pct(w.cn, W[i - 20].cn) : null;
    // daily % moves for the dollar & yuan model
    w.rFx = p ? pct(w.fx, p.fx) : null; w.rDx = p ? pct(w.dx, p.dx) : null; w.rCn = p ? pct(w.cn, p.cn) : null;
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
  // rolling dollar & yuan betas, estimated on the BW sessions before each day (no look-ahead)
  for (let i = 0; i < W.length; i++) {
    const y = [], a = [], b = [];
    for (let j = Math.max(1, i - BW); j < i; j++) { const v = W[j]; if (v.rFx != null && v.rDx != null && v.rCn != null) { y.push(v.rFx); a.push(v.rDx); b.push(v.rCn); } }
    const f = y.length >= BMIN ? ols2(y, a, b) : null, w = W[i];
    w.bDx = f?.b1 ?? null; w.bCn = f?.b2 ?? null; w.r2 = f?.r2 ?? null;
    w.res = f && w.rFx != null && w.rDx != null && w.rCn != null ? w.rFx - f.b1 * w.rDx - f.b2 * w.rCn : null;
  }
  // 20-session attribution: dollar part, yuan part, Korea-specific residual (all % of USD/KRW, additive)
  for (let i = 0; i < W.length; i++) {
    if (i < 20 || W[i].bDx == null) continue;
    let d = 0, c = 0, e = 0, ok = true;
    for (let j = i - 19; j <= i; j++) { const v = W[j]; if (v.rDx == null || v.rCn == null || v.rFx == null) { ok = false; break; } d += W[i].bDx * v.rDx; c += W[i].bCn * v.rCn; }
    if (!ok) continue;
    let tot = 0; for (let j = i - 19; j <= i; j++) tot += W[j].rFx; e = tot - d - c;
    W[i].att = { tot, dx: d, cn: c, kr: e };
  }

  // ---------- back-test, last two years ----------
  const last = W.at(-1).d, t0 = new Date(last + "T00:00:00Z"); t0.setUTCFullYear(t0.getUTCFullYear() - 2);
  const T0 = t0.toISOString().slice(0, 10);
  const i0 = Math.max(1, W.findIndex((w) => w.d >= T0));
  const ret = (i, h) => (W[i + h] ? (W[i + h].fx / W[i].fx - 1) * 100 : null);
  const resN = (i, h) => { if (!W[i + h]) return null; let s = 0; for (let j = i + 1; j <= i + h; j++) { if (W[j].res == null) return null; s += W[j].res; } return s; };
  const strat = (key, lag, hedged = false) => { // daily P&L in %: position from day t−lag earns the move from close t to t+1
    const p = []; let cum = 0, pk = 0, dd = 0;
    for (let i = i0; i < W.length - 1; i++) {
      const pos = W[i - lag]?.[key] ?? 0, mv = hedged ? W[i + 1].res ?? 0 : ret(i, 1), x = pos * mv;
      p.push(x); cum += x; pk = Math.max(pk, cum); dd = Math.min(dd, cum - pk);
    }
    return { p, cum, dd };
  };
  const summ = (s) => ({ cumPct: r(s.cum), sharpe: r(s.p.length > 20 && sd(s.p) ? (mean(s.p) / sd(s.p)) * Math.sqrt(252) : null), maxDdPct: r(s.dd) });
  const side = (key, h, lag, f = ret) => {
    const out = {};
    for (const [nm, sg] of [["long", 1], ["short", -1]]) {
      const v = []; for (let i = i0; i < W.length; i++) if (W[i][key] === sg) { const x = f(i + lag, h); if (x != null) v.push(x); }
      out[nm] = { days: v.length, hit: r(v.length ? v.filter((x) => x * sg > 0).length / v.length : null, 3), avgPct: r(v.length ? mean(v) : null) };
    }
    return out;
  };
  const ic = (key, h, lag, step = 1, f = ret) => {
    const a = [], b = []; for (let i = i0; i < W.length; i += step) { const x = f(i + lag, h); if (W[i][key] != null && x != null) { a.push(W[i][key]); b.push(x); } }
    return { ic: r(spearman(a, b)), n: a.length };
  };
  for (const w of W) { w.rCL = w.rC === 1 ? 1 : 0; w.rCS = w.rC === -1 ? -1 : 0; }
  const sA0 = strat("rA", 0), sA1 = strat("rA", 1), sAH = strat("rA", 0, true), sC1 = strat("rC", 1), sCL = strat("rCL", 1), sCS = strat("rCS", 1), sCH = strat("rC", 1, true);
  const hold = { p: [], cum: 0, dd: 0 }; { let pk = 0; for (let i = i0; i < W.length - 1; i++) { const x = ret(i, 1); hold.p.push(x); hold.cum += x; pk = Math.max(pk, hold.cum); hold.dd = Math.min(hold.dd, hold.cum - pk); } }
  // contemporaneous links (non-overlapping 5-day windows): flows vs USD/KRW, vs its Korea-specific part, dollar vs USD/KRW
  const c5 = { flowFx: [[], []], flowRes: [[], []], dxFx: [[], []], cnFx: [[], []] };
  for (let i = Math.max(i0, 5); i < W.length; i += 5) {
    if (W[i].x5 == null) continue;
    const fx5 = (W[i].fx / W[i - 5].fx - 1) * 100; let rs = 0, ok = true; for (let j = i - 4; j <= i; j++) { if (W[j].res == null) ok = false; else rs += W[j].res; }
    c5.flowFx[0].push(W[i].x5); c5.flowFx[1].push(fx5);
    if (ok) { c5.flowRes[0].push(W[i].x5); c5.flowRes[1].push(rs); }
    if (W[i].dx && W[i - 5].dx) { c5.dxFx[0].push((W[i].dx / W[i - 5].dx - 1) * 100); c5.dxFx[1].push(fx5); }
    if (W[i].cn && W[i - 5].cn) { c5.cnFx[0].push((W[i].cn / W[i - 5].cn - 1) * 100); c5.cnFx[1].push(fx5); }
  }
  // flow-exhaustion episodes (consecutive days in the same non-zero regime), 20-day result from the day after the start
  const episodes = [];
  for (let i = i0; i < W.length; i++) {
    const g = W[i].rC; if (!g || W[i - 1]?.rC === g) continue;
    let j = i; while (W[j + 1]?.rC === g) j++;
    const f = ret(i + 1, 20), fh = resN(i + 1, 20);
    episodes.push({ from: W[i].d, to: W[j].d, side: g, days: j - i + 1, C: r(W[i].C), fx0: r(W[i + 1]?.fx ?? W[i].fx, 2), fwd20Pct: r(f), fwd20ResPct: r(fh), open: f == null });
  }
  const epSum = () => Object.fromEntries([["long", 1], ["short", -1]].map(([nm, g]) => {
    const e = episodes.filter((x) => x.side === g && x.fwd20Pct != null);
    return [nm, { n: e.length, right: e.filter((x) => x.fwd20Pct * g > 0).length, avgFwd20Pct: r(e.length ? mean(e.map((x) => x.fwd20Pct)) : null), rightHedged: e.filter((x) => (x.fwd20ResPct ?? 0) * g > 0).length }];
  }));
  const L = W.at(-1);
  const backtest = {
    from: W[i0].d, to: last, days: W.length - 1 - i0,
    contemp5dCorr: r(pear(...c5.flowFx)), contemp5dCorrHedged: r(pear(...c5.flowRes)), dxy5dCorr: r(pear(...c5.dxFx)), cnh5dCorr: r(pear(...c5.cnFx)),
    pressure: { threshold: TH_A, sameDay: summ(sA0), oneDayLate: summ(sA1), hedged: summ(sAH), next2d: side("rA", 2, 0), next2dLate: side("rA", 2, 1), next2dHedged: side("rA", 2, 0, resN), ic1: ic("A", 1, 0), ic1Late: ic("A", 1, 1), ic1Hedged: ic("A", 1, 0, 1, resN), inMarket: r(W.slice(i0).filter((w) => w.rA).length / (W.length - i0), 3) },
    exhaustion: { threshold: TH_C, oneDayLate: summ(sC1), hedged: summ(sCH), longOnly: summ(sCL), shortOnly: summ(sCS), episodes: epSum(), next20d: side("rC", 20, 1), ic20: ic("C", 20, 1), ic20NonOverlap: ic("C", 20, 1, 20), ic20Hedged: ic("C", 20, 1, 1, resN), inMarket: r(W.slice(i0).filter((w) => w.rC).length / (W.length - i0), 3) },
    hold: summ(hold),
    model: { window: BW, betaDxy: r(L.bDx), betaCnh: r(L.bCn), r2: r(L.r2) },
  };
  const curve = []; { let a = 0, b = 0, h = 0, c = 0, l = 0, s = 0, o = 0; for (let k = 0, i = i0; i < W.length - 1; i++, k++) { a += sA0.p[k]; b += sA1.p[k]; h += sAH.p[k]; c += sC1.p[k]; l += sCL.p[k]; s += sCS.p[k]; o += hold.p[k]; curve.push([W[i + 1].d, r(a), r(b), r(h), r(c), r(l), r(s), r(o)]); } }

  const series = W.map((w) => [w.d, w.fx, w.ks, r(w.net, 3), r(w.x5), r(w.x20), r(w.eq20), r(w.A), r(w.C), w.rA, w.rC, r(w.net20, 2), r(w.pen20, 2), r(w.ret20, 2), r(w.att?.dx), r(w.att?.cn), r(w.att?.kr), r(w.bDx), r(w.bCn)]);
  const sumN = (k, n) => r(W.slice(-n).reduce((s, w) => s + (w[k] ?? 0), 0), 2);
  const latest = {
    date: L.d, fx: L.fx, kospi: L.ks, turnover: r(L.tv, 2), net: r(L.net, 3), pen: r(L.pen, 3), retail: r(L.ret, 3), inst: r(L.inst, 3),
    x1: r(L.x1), x5: r(L.x5), x20: r(L.x20), eq20: r(L.eq20), net5: sumN("net", 5), net20: r(L.net20, 2), net60: sumN("net", 60), pen20: r(L.pen20, 2), ret20: r(L.ret20, 2),
    fx20: r(L.fx20), dx: L.dx, dx20: r(L.dx20), cnh: L.cn, cn20: r(L.cn20),
    att: L.att ? { tot: r(L.att.tot), dx: r(L.att.dx), cn: r(L.att.cn), kr: r(L.att.kr) } : null,
    A: r(L.A), C: r(L.C), rA: L.rA, rC: L.rC,
    z: Object.fromEntries(Object.entries(L.z).map(([k, v]) => [k, r(v)])),
    A5ago: r(W.at(-6)?.A), C5ago: r(W.at(-6)?.C),
  };
  const auto = autoNotes(backtest, latest);
  return {
    auto,
    cols: ["date", "usdkrw", "kospi", "foreignNetTn", "flow5Pct", "flow20Pct", "kospi20Pct", "pressure", "exhaustion", "regPressure", "regExhaustion", "foreignNet20Tn", "pensionNet20Tn", "retailNet20Tn", "att20Dxy", "att20Cnh", "att20Korea", "betaDxy", "betaCnh"],
    method: { turnoverProxy: proxy, zWindow: ZW, zMin: ZMIN, pressureTh: TH_A, exhaustionTh: TH_C, betaWindow: BW },
    series, backtest, curveCols: ["date", "pressureSameDay", "pressureLate", "pressureHedged", "exhaustion", "exhaustionLongOnly", "exhaustionShortOnly", "holdLong"], curve, episodes, latest,
  };
}

// Plain-English findings generated from the back-test numbers, so the panel never quotes stale figures. The daily
// expert read (the `notes` key) replaces the headline and commentary; `auto` is the fallback and the fact base.
const s = (v, d = 2, u = "") => (v == null ? "n/a" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + u);
const p = (x) => (x == null ? "n/a" : Math.round(x * 100) + "%");
function autoNotes(b, L) {
  const P = b.pressure, E = b.exhaustion, el = E.episodes.long, es = E.episodes.short;
  const edge = (sh) => (sh == null ? "unmeasured" : sh >= 1 ? "a clear edge" : sh >= 0.5 ? "a modest edge" : sh > 0 ? "a thin edge" : "no edge");
  const f = [];
  f.push(["Flows and the won move together",
    `Over 5-day windows, foreign net buying of KOSPI shares and USD/KRW have a ${s(b.contemp5dCorr)} correlation (negative = buying goes with a stronger won). Stripping out the dollar index and the yuan, the link to the Korea-specific part of the move is ${s(b.contemp5dCorrHedged)}. For scale, the dollar index alone correlates ${s(b.dxy5dCorr)} with USD/KRW and USD/CNH ${s(b.cnh5dCorr)}.`]);
  f.push(["How much is the dollar and the yuan",
    `On the latest 250 sessions, a 1% rise in the dollar index has come with a ${s(b.model.betaDxy)}% move in USD/KRW and a 1% rise in USD/CNH with ${s(b.model.betaCnh)}%; together they explain ${b.model.r2 == null ? "n/a" : Math.round(b.model.r2 * 100) + "%"} of daily moves. The rest is Korea-specific, which is where equity flows should show up.`]);
  f.push(["Short-term flow pressure (1–2 days)",
    `Acting at the close on the day KRX posts the flows, the pressure signal returned ${s(P.sameDay.cumPct, 1, "%")} over two years (Sharpe ${P.sameDay.sharpe ?? "n/a"}, IC ${P.ic1.ic ?? "n/a"}): ${edge(P.sameDay.sharpe)}. One day late it was ${s(P.oneDayLate.cumPct, 1, "%")} (Sharpe ${P.oneDayLate.sharpe ?? "n/a"}). Against the Korea-specific move only it made ${s(P.hedged.cumPct, 1, "%")} (Sharpe ${P.hedged.sharpe ?? "n/a"}). Over the next two days it was right ${p(P.next2d.long.hit)} of long days and ${p(P.next2d.short.hit)} of short days.`]);
  f.push(["After a month of heavy flows (exhaustion)",
    `After heavy foreign buying and a strong KOSPI (exhaustion ≥ +1), USD/KRW rose over the next 20 sessions in ${el.right} of ${el.n} episodes (avg ${s(el.avgFwd20Pct, 2, "%")}). After heavy selling (≤ −1), the won rebounded in ${es.right} of ${es.n} (avg ${s(es.avgFwd20Pct, 2, "%")}). With so few independent episodes, treat a side as tradable only when its record is clearly better than a coin flip; long-only ${s(E.longOnly.cumPct, 1, "%")} (Sharpe ${E.longOnly.sharpe ?? "n/a"}), short-only ${s(E.shortOnly.cumPct, 1, "%")} (Sharpe ${E.shortOnly.sharpe ?? "n/a"}).`]);
  return {
    headline: `Foreigners net ${L.net20 >= 0 ? "bought" : "sold"} KRW ${Math.abs(L.net20 ?? 0).toFixed(1)} tn of KOSPI shares over 20 sessions while USD/KRW moved ${s(L.fx20, 1, "%")} to ${L.fx?.toFixed(1)}. Flow pressure is ${s(L.A)} and exhaustion ${s(L.C)}.`,
    findings: f,
    caveats: `Two years is a short sample, and the one-month results rest on about two dozen independent 20-day windows. Flows are KOSPI only (no KOSDAQ, bonds, NPS currency hedging or retail purchases of US stocks, which are large won outflows that this panel cannot see daily). USD/KRW is Yahoo's daily close, which can differ from the 15:30 Seoul onshore close and the 02:00 extended session. Results ignore costs and carry (forward points). A research signal, not financial advice.`,
  };
}
