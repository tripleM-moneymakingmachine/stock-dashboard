// Korea tab, "KOSPI ↔ KTB rotation": how US Treasuries feed into KTBs, and what that means for the rotation
// signal's back-test. Used by scripts/fetch-korea-flows.mjs.
//
// Timing. The US session for New York date D closes at about 05:00 Singapore / 06:00 Seoul on D+1, before KOFIA's
// next close (15:30 Seoul). So for each Seoul business day t the "overnight" Treasury move is the change between
// the last New York closes strictly before t and strictly before the previous Seoul day (holidays on either side
// are rolled together). Weekly, the Treasury level used for a week is the last New York close before that week's
// KTB close, so nothing in the back-test uses information the KTB market could not yet see.
//
// Daily study (KOFIA 10Y/3Y final quotes vs US Treasury 10Y/2Y par yields): OLS beta of the KTB daily change on
// the overnight Treasury change, correlation and R², by calendar year, rolling 60 days, up vs down moves,
// same-direction rate on big (≥ 7bp) Treasury moves, next-day spill-over (does KTB keep moving the following
// day?), and the Seoul-to-New-York overlap.
//
// Weekly back-test variants, all walk-forward with the same z-score windows and ±0.5 thresholds as the live signal:
//   S0 the live signal (KOSPI, margin credit, bond ETF share, KTB 10Y trend)
//   S1 S0 plus the US 10Y 4-week trend as a fifth component
//   S2 the US 10Y trend in place of the KTB trend
//   S3 local flows only (KOSPI, margin credit, ETF share)
//   S4 the US 10Y trend on its own
// each traded two ways: outright 10Y KTB duration, and UST-hedged (long/short KTB 10Y against β × US 10Y, β the
// trailing 26-week weekly beta known at the time), which isolates the Korea-specific part of the move.
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r = (x, n = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(n));
function ols(x, y) {
  const n = x.length; if (n < 5) return null;
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  const beta = sxx ? sxy / sxx : null, corr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  return { beta, alpha: beta == null ? null : my - beta * mx, corr, r2: corr == null ? null : corr * corr, n };
}
const lastBefore = (sorted, d) => { let lo = 0, hi = sorted.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (sorted[m] < d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };

export function study(raw, W) {
  const k10 = new Map(raw.ktb10d || []), k3 = new Map(raw.ktb3d || []), u10 = new Map(raw.ust10d || []), u2 = new Map(raw.ust2d || []);
  const kd = [...k10.keys()].sort(), ud = [...u10.keys()].sort();
  if (kd.length < 200 || ud.length < 200) return null;
  const L = (t) => { const i = lastBefore(ud, t); return i >= 0 ? ud[i] : null; };

  // ---------- daily ----------
  const D = [];
  for (let i = 1; i < kd.length; i++) {
    const t = kd[i], tp = kd[i - 1], a = L(t), b = L(tp);
    if (!a || !b) continue;
    D.push({ d: t, dk: (k10.get(t) - k10.get(tp)) * 100, dk3: k3.has(t) && k3.has(tp) ? (k3.get(t) - k3.get(tp)) * 100 : null, du: (u10.get(a) - u10.get(b)) * 100, du2: u2.has(a) && u2.has(b) ? (u2.get(a) - u2.get(b)) * 100 : null, ny: a });
  }
  const fit = (rows, ky = "dk", kx = "du") => { const v = rows.filter((x) => x[ky] != null && x[kx] != null); return ols(v.map((x) => x[kx]), v.map((x) => x[ky])); };
  const pack = (o) => o && { beta: r(o.beta), corr: r(o.corr), r2: r(o.r2), n: o.n };
  const years = [...new Set(D.map((x) => x.d.slice(0, 4)))].filter((y) => D.filter((x) => x.d.startsWith(y)).length >= 60);
  const byYear = years.map((y) => { const s = D.filter((x) => x.d.startsWith(y)); return { year: y, ...pack(fit(s)), beta3: r(fit(s, "dk3")?.beta), sdK: r(sd(s.map((x) => x.dk)), 1), sdU: r(sd(s.map((x) => x.du)), 1) }; });
  const big = D.filter((x) => Math.abs(x.du) >= 7), same = big.filter((x) => Math.sign(x.dk) === Math.sign(x.du)).length;
  const next = ols(D.slice(0, -1).map((x) => x.du), D.slice(1).map((x) => x.dk));
  const nyAfter = ols(D.slice(0, -1).map((x) => x.dk), D.slice(1).map((x) => x.du)); // Seoul close → that night's New York session
  const buckets = [[-99, -10], [-10, -5], [-5, -2], [-2, 2], [2, 5], [5, 10], [10, 99]].map(([lo, hi]) => { const s = D.filter((x) => x.du >= lo && x.du < hi); return { lo, hi, n: s.length, du: r(s.length ? mean(s.map((x) => x.du)) : null, 1), dk: r(s.length ? mean(s.map((x) => x.dk)) : null, 1), same: r(s.length ? s.filter((x) => Math.sign(x.dk) === Math.sign(x.du)).length / s.length : null, 2) }; });
  const roll = [];
  for (let i = 59; i < D.length; i++) { const o = fit(D.slice(i - 59, i + 1)); roll.push([D[i].d, r(o.beta), r(o.corr)]); }
  const y1 = D.slice(-250), b1 = fit(y1);
  const scatter = y1.map((x) => [x.d, r(x.du, 1), r(x.dk, 1)]);
  // latest overnight: New York closes since the last KOFIA close (known before the next Seoul session)
  const lastK = kd.at(-1), iK = lastBefore(ud, lastK), nyNew = ud.slice(iK + 1);
  const on = nyNew.length ? { from: ud[iK], to: nyNew.at(-1), sessions: nyNew.length, du: r((u10.get(nyNew.at(-1)) - u10.get(ud[iK])) * 100, 1), du2: u2.has(nyNew.at(-1)) && u2.has(ud[iK]) ? r((u2.get(nyNew.at(-1)) - u2.get(ud[iK])) * 100, 1) : null } : null;
  if (on) on.impliedKtbBp = r(on.du * b1.beta, 1);

  const daily = {
    from: D[0].d, to: D.at(-1).d, all: pack(fit(D)), y1: pack(b1), d60: pack(fit(D.slice(-60))), beta3y1: r(fit(y1, "dk3")?.beta),
    up: pack(fit(D.filter((x) => x.du > 0))), down: pack(fit(D.filter((x) => x.du < 0))),
    bigMoves: { n: big.length, sameDir: r(same / big.length, 3), medianPassThrough: r([...big.map((x) => x.dk / x.du)].sort((a, b) => a - b)[Math.floor(big.length / 2)], 2) },
    nextDay: { beta: r(next.beta, 3), corr: r(next.corr, 3) }, seoulToNy: { beta: r(nyAfter.beta, 3), corr: r(nyAfter.corr, 3) },
    byYear, buckets, roll: roll.filter(([d]) => d >= `${+D.at(-1).d.slice(0, 4) - 2}${D.at(-1).d.slice(4)}`), scatter, overnight: on,
  };

  // ---------- weekly: attach Treasury levels to the rotation weeks ----------
  for (let i = 0; i < W.length; i++) {
    const w = W[i], a = L(w.date);
    w.ust = a ? u10.get(a) : null; w.ustD = a;
    const p = W[i - 4];
    w.du4 = p && w.ust != null && p.ust != null ? (w.ust - p.ust) * 100 : null;
    w.sp = w.ust != null ? (w.y10 - w.ust) * 100 : null;
    const win = []; for (let j = Math.max(1, i - 25); j <= i; j++) if (W[j].ust != null && W[j - 1].ust != null) win.push([(W[j].ust - W[j - 1].ust) * 100, (W[j].y10 - W[j - 1].y10) * 100]);
    const o = win.length >= 20 ? ols(win.map((x) => x[0]), win.map((x) => x[1])) : null;
    w.beta = o?.beta ?? null; w.corrU = o?.corr ?? null;
  }
  const z = (i, f) => {
    const h = W.slice(Math.max(0, i - 51), i + 1).map((x) => x[f]).filter((x) => x != null);
    if (h.length < 26 || W[i][f] == null) return null; const s = sd(h); return s ? (W[i][f] - mean(h)) / s : 0;
  };
  const SPECS = [
    { k: "S0", name: "Live signal: KOSPI, margin credit, ETF share, KTB 10Y trend", c: [["eq4", -1], ["dm4", -1], ["bsDev", 1], ["dy4", -1]], live: true },
    { k: "S1", name: "Live signal + US 10Y 4-week trend", c: [["eq4", -1], ["dm4", -1], ["bsDev", 1], ["dy4", -1], ["du4", -1]] },
    { k: "S2", name: "US 10Y trend in place of the KTB trend", c: [["eq4", -1], ["dm4", -1], ["bsDev", 1], ["du4", -1]] },
    { k: "S3", name: "Local flows only (KOSPI, margin, ETF share)", c: [["eq4", -1], ["dm4", -1], ["bsDev", 1]] },
    { k: "S4", name: "US 10Y trend alone", c: [["du4", -1]] },
  ];
  const TH = 0.5, H = 4;
  const run = (spec) => {
    const reg = W.map((w, i) => { const p = spec.c.map(([f, s]) => { const v = z(i, f); return v == null ? null : s * v; }).filter((x) => x != null); if (p.length < Math.max(1, spec.c.length - 1)) return null; const S = mean(p); return S >= TH ? 1 : S <= -TH ? -1 : 0; });
    const first = reg.findIndex((x, i) => x != null && W[i].beta != null && W[i].ust != null);
    const out = { k: spec.k, name: spec.name, live: !!spec.live, from: W[first]?.date };
    for (const mode of ["outright", "hedged"]) {
      const pnl = [], hit = { 1: [], [-1]: [] }; let cum = 0, pk = 0, dd = 0;
      for (let i = first; i < W.length - 1; i++) {
        const pos = reg[i] ?? 0, b = mode === "hedged" ? W[i].beta : 0;
        const mv = ((W[i + 1].y10 - W[i].y10) - b * (W[i + 1].ust - W[i].ust)) * 100;
        const p = -pos * mv; pnl.push(p); cum += p; pk = Math.max(pk, cum); dd = Math.min(dd, cum - pk);
        if ((reg[i] === 1 || reg[i] === -1) && W[i + H]) hit[reg[i]].push(((W[i + H].y10 - W[i].y10) - b * (W[i + H].ust - W[i].ust)) * 100);
      }
      out[mode] = { weeks: pnl.length, cumBp: r(cum, 1), sharpe: r(sd(pnl) ? (mean(pnl) / sd(pnl)) * Math.sqrt(52) : null), maxDdBp: r(dd, 1), volBp: r(sd(pnl) * Math.sqrt(52), 0),
        rally: { n: hit[1].length, hit: r(hit[1].length ? hit[1].filter((x) => x < 0).length / hit[1].length : null, 3) }, selloff: { n: hit[-1].length, hit: r(hit[-1].length ? hit[-1].filter((x) => x > 0).length / hit[-1].length : null, 3) } };
    }
    out.reg = reg;
    return out;
  };
  const variants = SPECS.map(run);
  // sub-period check of the live signal, outright vs hedged
  const live = variants[0], split = W.findIndex((w) => w.date >= "2025-03-01");
  const sub = (a, b, mode) => { const p = []; for (let i = Math.max(a, W.findIndex((w) => w.date >= live.from)); i < b - 1; i++) { const bb = mode === "hedged" ? W[i].beta : 0; if (live.reg[i] == null || bb == null) continue; p.push(-(live.reg[i] || 0) * ((W[i + 1].y10 - W[i].y10) - bb * (W[i + 1].ust - W[i].ust)) * 100); } return { weeks: p.length, cumBp: r(p.reduce((s, x) => s + x, 0), 1), sharpe: r(sd(p) ? (mean(p) / sd(p)) * Math.sqrt(52) : null) }; };
  const periods = split > 0 ? [[`${live.from.slice(0, 7)} – 2025-02`, 0, split], [`2025-03 – ${W.at(-1).date.slice(0, 7)}`, split, W.length]].map(([l, a, b]) => ({ label: l, outright: sub(a, b, "outright"), hedged: sub(a, b, "hedged") })) : [];
  // hedged equity curve of the live signal (bp), for the back-test chart
  const hedgedCurve = []; { let c = 0, cl = 0; const f0 = W.findIndex((w) => w.date >= live.from); for (let i = f0; i < W.length - 1; i++) { const b = W[i].beta; if (b == null) continue; const mv = ((W[i + 1].y10 - W[i].y10) - b * (W[i + 1].ust - W[i].ust)) * 100, pos = live.reg[i] ?? 0; c += -pos * mv; cl += -(pos > 0 ? 1 : 0) * mv; hedgedCurve.push([W[i + 1].date, r(c, 1), r(cl, 1)]); } }
  variants.forEach((v) => delete v.reg);
  // last 4 weeks: how much of the KTB move the Treasury beta explains
  const w = W.at(-1), p4 = W.at(-5);
  const attr = w && p4 && w.beta != null ? { weeks: 4, ktbBp: r((w.y10 - p4.y10) * 100, 1), ustBp: r((w.ust - p4.ust) * 100, 1), beta: r(w.beta), ustPartBp: r(w.beta * (w.ust - p4.ust) * 100, 1), localBp: r(((w.y10 - p4.y10) - w.beta * (w.ust - p4.ust)) * 100, 1) } : null;
  const sps = W.filter((x) => x.sp != null).slice(-52).map((x) => x.sp);
  const weekly = {
    beta: r(w.beta), corr: r(w.corrU), ust: w.ust, ustDate: w.ustD, spreadBp: r(w.sp, 1), spreadPct: r(sps.filter((x) => x < w.sp).length / sps.length, 2), spreadLo52: r(Math.min(...sps), 1), spreadHi52: r(Math.max(...sps), 1),
    du4: r(w.du4, 1), attr,
  };
  return { daily, weekly, variants, periods, hedgedCurve, method: "Overnight = New York closes strictly before each KOFIA close. Hedged = KTB 10Y minus β × US 10Y, β the trailing 26-week weekly beta known at the time. All variants walk-forward, z-scores vs trailing 52 weeks, thresholds ±0.5, hit rates over the next 4 weeks." };
}
