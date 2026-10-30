// Korea tab, "KTB futures": the 3Y, 5Y, 10Y and 30Y Korea Treasury Bond futures on KRX, valued from KOFIA's
// daily yields for each contract's delivery basket (국채선물수익률).
// KRX settles KTB futures in cash against a notional bond (5% coupon, semi-annual, 3/5/10/30 years), priced at the
// simple average of the basket bonds' KOFIA yields. So the basket average is the futures' implied yield, and
// price = Σ 2.5/(1+r/200)^i (i = 1..2n) + 100/(1+r/200)^2n. KRX market quotes need an exchange API key, so this is
// the fair value at the KOFIA close, not a traded price. Writes data/ktb-futures.json (one year, incremental).
import { readFileSync, writeFileSync } from "node:fs";
import { futBasketDay, finalQuoteHistory, kst, addDays } from "./kofia.mjs";

const OUT = "data/ktb-futures.json";
const log = (...a) => console.log(...a);
const today = kst();
let prev = {};
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

const P = [
  { p: "3Y", n: 3, name: "3-year KTB futures", krx: "KTB 3Y (3년국채선물)", lo: 0, hi: 3.3 },
  { p: "5Y", n: 5, name: "5-year KTB futures", krx: "KTB 5Y (5년국채선물)", lo: 3.3, hi: 6.5 },
  { p: "10Y", n: 10, name: "10-year KTB futures", krx: "KTB 10Y (10년국채선물)", lo: 6.5, hi: 15 },
  { p: "30Y", n: 30, name: "30-year KTB futures", krx: "KTB 30Y (30년국채선물)", lo: 15, hi: 60 },
];
const price = (r, n) => { const v = 1 + r / 200; let s = 0; for (let i = 1; i <= 2 * n; i++) s += 2.5 / v ** i; return s + 100 / v ** (2 * n); };
const matOf = (name) => { const m = /\d{5}-(\d{2})(\d{2})/.exec(name); return m ? `20${m[1]}-${m[2]}-10` : null; };
const ttm = (mat, d) => (Date.parse(mat) - Date.parse(d)) / (365.25 * 864e5);
// front contract: quarterly (Mar/Jun/Sep/Dec), last trading day the third Tuesday of the month
function front(d) {
  const t = new Date(d + "T12:00:00Z");
  for (let k = 0; k < 6; k++) {
    const y = t.getUTCFullYear(), m0 = t.getUTCMonth();
    const qm = [2, 5, 8, 11].find((q) => q >= m0) ?? 2, yy = qm < m0 ? y + 1 : y;
    const first = new Date(Date.UTC(yy, qm, 1)), dow = first.getUTCDay(), tue = 1 + ((2 - dow + 7) % 7) + 14;
    const ltd = new Date(Date.UTC(yy, qm, tue)).toISOString().slice(0, 10);
    if (ltd >= d) return { month: `${yy}-${String(qm + 1).padStart(2, "0")}`, ltd };
    t.setUTCMonth(qm + 1, 1);
  }
  return null;
}

// business days from KOFIA's 3Y KTB quote history
let days = [];
try { days = (await finalQuoteHistory(["3000"], addDays(today, -370), today))["3000"].map(([d]) => d); } catch (e) { log(`dates: ${e.message}`); }
if (!days.length) { log("no business days; leaving file unchanged"); process.exit(0); }
const have = new Map((prev.days || []).map((x) => [x.d, x]));
const need = days.filter((d) => !have.has(d) || d >= addDays(days.at(-1), -3));
log(`basket days to fetch: ${need.length}`);
let i = 0, fails = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < need.length) {
    const d = need[i++];
    try {
      const rows = await futBasketDay(d);
      if (!rows.length) continue;
      const by = {};
      for (const r of rows) { const mat = matOf(r.name); if (!mat) continue; const t = ttm(mat, d), p = P.find((x) => t >= x.lo && t < x.hi); if (p) (by[p.p] ||= []).push({ name: r.name, isin: r.isin, mat, y: r.pm, am: r.am }); }
      have.set(d, { d, b: by });
    } catch (e) { fails++; }
  }
}));
log(`fetched (${fails} failed)`);
const D = [...have.values()].filter((x) => x.d >= days[0]).sort((a, b) => a.d.localeCompare(b.d));
const last = D.at(-1);
const products = P.map((p) => {
  const hist = D.map((x) => { const b = x.b[p.p]; if (!b?.length) return null; const r = b.reduce((s, q) => s + q.y, 0) / b.length; return [x.d, +price(r, p.n).toFixed(2), +r.toFixed(4)]; }).filter(Boolean);
  const bk = last?.b[p.p] || [];
  const l = hist.at(-1), pv = hist.at(-2);
  const back = (n) => { const cut = addDays(l[0], -n); for (let j = hist.length - 1; j >= 0; j--) if (hist[j][0] <= cut) return hist[j]; return null; };
  const w = l && back(7), m = l && back(30);
  // DV01 per KRW 100m contract (KRW 1m multiplier per point)
  const dv01 = l ? +((price(l[2] - 0.005, p.n) - price(l[2] + 0.005, p.n)) * 1e6).toFixed(0) : null;
  return {
    p: p.p, term: p.n, name: p.name, krx: p.krx, face: "KRW 100m notional, 5% semi-annual coupon", multiplier: 1e6,
    basket: bk.map((q) => ({ ...q, ttm: +ttm(q.mat, last.d).toFixed(2) })),
    fair: l?.[1] ?? null, yld: l?.[2] ?? null, chgPts: l && pv ? +(l[1] - pv[1]).toFixed(2) : null, chgBp: l && pv ? +((l[2] - pv[2]) * 100).toFixed(1) : null,
    wkBp: l && w ? +((l[2] - w[2]) * 100).toFixed(1) : null, moBp: l && m ? +((l[2] - m[2]) * 100).toFixed(1) : null, dv01Krw: dv01, hist,
  };
});
const out = {
  updated: Math.floor(Date.now() / 1000), settleDate: last?.d, front: front(last?.d || today),
  src: "KOFIA KTB futures basket yields (국채선물수익률, 15:30 KST close); fair value computed by the dashboard with KRX's settlement formula",
  coupon: 5, products, days: D,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${D.length} days to ${last?.d}; ` + products.map((p) => `${p.p} ${p.fair} (${p.yld}%, ${p.basket.length} bonds)`).join(", "));
