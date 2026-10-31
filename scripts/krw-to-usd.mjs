// SK hynix page: converts the Seoul listing's daily OHLC (skhy/data/krx/history.json, in won)
// into US dollars per share, so the technical chart and the daily read show USD figures.
// Each day is divided by that day's USD/KRW rate (the latest rate on or before the date).
// Rates come from skhy/data/fx/history.json (Yahoo KRW=X, saved by fetch-quote.mjs),
// topped up with ECB reference rates from Frankfurter when Yahoo is missing or stale.
// Writes skhy/data/krx-usd/history.json. On failure it keeps the existing file and exits 0.
// Usage: node scripts/krw-to-usd.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const SRC = "skhy/data/krx/history.json";
const FX = "skhy/data/fx/history.json";
const OUT = "skhy/data/krx-usd/history.json";
const load = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

const krx = load(SRC);
if (!krx?.d?.length) { console.log(`krw-to-usd: no won history at ${SRC}; keeping ${OUT}`); process.exit(0); }

const rates = new Map(); // YYYY-MM-DD -> won per US$
const yahoo = load(FX);
if (yahoo?.d?.length) yahoo.d.forEach((d, i) => { const r = yahoo.c[i]; if (r > 500 && r < 3000) rates.set(d, r); });

async function frankfurter(from) {
  const urls = [
    `https://api.frankfurter.app/${from}..?from=USD&to=KRW`,
    `https://api.frankfurter.dev/v1/${from}..?from=USD&to=KRW`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      let n = 0;
      for (const [d, v] of Object.entries(j.rates || {})) if (v?.KRW && !rates.has(d)) { rates.set(d, v.KRW); n++; }
      console.log(`krw-to-usd: ${n} ECB rates from ${new URL(u).host}`);
      return;
    } catch (e) { console.log(`krw-to-usd: ${u.split("?")[0]} failed: ${e.message}`); }
  }
}

const first = krx.d[0], last = krx.d.at(-1);
const days = [...rates.keys()].sort();
if (!days.length || days[0] > first || days.at(-1) < last) await frankfurter(shift(first, -10));

function shift(d, n) { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

const sorted = [...rates.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
if (!sorted.length) { console.log(`krw-to-usd: no USD/KRW rates; keeping ${OUT}`); process.exit(0); }

// As-of join: rate on or before each date (KRX dates are stored as the New York calendar day).
let j = 0, missing = 0;
const out = { d: [], o: [], h: [], l: [], c: [], v: [], fx: [] };
const r2 = (x) => (x == null ? null : +x.toFixed(2));
krx.d.forEach((d, i) => {
  while (j + 1 < sorted.length && sorted[j + 1][0] <= d) j++;
  let rate = sorted[j][0] <= d ? sorted[j][1] : null;
  if (rate == null) { rate = sorted[0][1]; missing++; }
  out.d.push(d);
  out.o.push(r2(krx.o?.[i] / rate)); out.h.push(r2(krx.h?.[i] / rate)); out.l.push(r2(krx.l?.[i] / rate)); out.c.push(r2(krx.c[i] / rate));
  out.v.push(krx.v?.[i] ?? null); out.fx.push(+rate.toFixed(2));
});
// Stale-rate guard: if the newest rate is more than 7 days older than the newest bar, don't overwrite.
if ((new Date(last) - new Date(sorted.at(-1)[0])) / 864e5 > 7 && existsSync(OUT)) {
  console.log(`krw-to-usd: newest rate ${sorted.at(-1)[0]} is stale vs ${last}; keeping ${OUT}`);
  process.exit(0);
}
mkdirSync("skhy/data/krx-usd", { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`krw-to-usd: wrote ${out.d.length} bars to ${OUT} (last ${last}: ₩${krx.c.at(-1)} / ${out.fx.at(-1)} = $${out.c.at(-1)}${missing ? `; ${missing} early bars used the first rate` : ""})`);
