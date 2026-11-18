// Malaysia tab, FX-swap implied ringgit yields (data/malaysia-fxswap.json). Covered interest parity on the USD/MYR
// forward curve: the ringgit rate that makes a dollar deposit swapped into ringgit pay the same as the forward implies.
//   implied MYR = ((F / S) × (1 + r_USD × d/365) − 1) × 365/d      (simple, act/365, for every quoted tenor)
//   F = USD/MYR outright forward (mid, also bid / ask), S = spot, d = days, r_USD = US Treasury yield at the tenor
//   (home.treasury.gov daily par curve, 1M–2Y, joined linearly).
// Forwards: FXEmpire's USD/MYR forward-rates page (indicative, offshore-style quotes; 1W–1Y, plus 2Y when quoted),
// read here at the Kuala Lumpur evening run; earlier days come from data/fx-fwd.json's daily USD/MYR snapshots.
// Treasuries are not a USD money-market rate (SOFR / deposit rates usually sit a little above bills), so the levels are
// indicative; the day-to-day moves and the gap to onshore MYR rates are the useful part.
// Usage: node scripts/fetch-malaysia-fxswap.mjs. Anything that fails keeps the previous file.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OUT = "data/malaysia-fxswap.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const log = (...a) => console.log(...a);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const num = (s) => parseFloat(String(s).replace(/,/g, ""));
const r4 = (v) => v == null || !isFinite(v) ? null : +(+v).toFixed(4);
const TENORS = [["1W", 7, "One Week"], ["2W", 14, "Two Weeks"], ["1M", 30, "One Month"], ["2M", 61, "Two Months"], ["3M", 91, "Three Months"], ["4M", 122, "Four Months"], ["5M", 152, "Five Months"], ["6M", 182, "Six Months"], ["9M", 273, "Nine Months"], ["1Y", 365, "One Year"], ["2Y", 730, "Two Years"]];
const KEEP = new Date(Date.now() - 3 * 366 * 864e5).toISOString().slice(0, 10);
const klDay = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

// 1. today's curve from FXEmpire
let live = null;
try {
  const r = await fetch("https://www.fxempire.com/currencies/usd-myr/forward-rates", { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const N = "(-?[\\d,]+(?:\\.\\d+)?)";
  const spot = num((txt.match(new RegExp(`Spot Rate:?\\s*${N}`)) || [])[1]);
  const rows = [];
  for (const [t, days, lab] of TENORS) {
    const m = txt.match(new RegExp(`${lab}\\s+${N}\\s+${N}\\s+${N}`)); if (!m) continue;
    const [bid, ask, mid] = m.slice(1, 4).map(num);
    if (bid > 0 && ask >= bid && mid >= bid && mid <= ask && Math.abs(mid / spot - 1) < 0.1) rows.push({ t, days, bid, ask, mid });
  }
  if (!(spot > 3 && spot < 6) || rows.length < 6) throw new Error(`parse: spot ${spot}, ${rows.length} tenors`);
  live = { d: klDay(Date.now()), spot, rows, time: Math.floor(Date.now() / 1000) };
  log(`FXEmpire USD/MYR: spot ${spot}, ${rows.map((x) => x.t).join(" ")}`);
} catch (e) { log(`FXEmpire USD/MYR failed: ${e.message}`); }

// 2. curve history: our own stored days, plus the FX tab's daily USD/MYR snapshots (data/fx-fwd.json)
const curves = new Map(Object.entries(prev.curves || {})); // d → { spot, m: { t: mid }, b: {t: bid}, a: {t: ask} }
try {
  const f = JSON.parse(readFileSync("data/fx-fwd.json", "utf8")).pairs?.usdmyr;
  for (const h of f?.hist || []) if (h.d && h.spot && !curves.has(h.d)) curves.set(h.d, { spot: h.spot, m: h.m });
} catch {}
if (live) curves.set(live.d, { spot: live.spot, m: Object.fromEntries(live.rows.map((x) => [x.t, x.mid])), b: Object.fromEntries(live.rows.map((x) => [x.t, x.bid])), a: Object.fromEntries(live.rows.map((x) => [x.t, x.ask])) });
if (!curves.size) { log("No USD/MYR forward curve; not writing."); process.exit(0); }

// 3. US Treasury par yields, 1M–2Y
const ust = new Map(Object.entries(prev.ust || {})); // d → [[years, yield%]]
for (const yr of [...new Set([new Date().getUTCFullYear(), ...[...curves.keys()].map((d) => +d.slice(0, 4))])].sort()) {
  if (yr < new Date().getUTCFullYear() && [...ust.keys()].some((d) => d.startsWith(yr + "-12"))) continue; // past years are final once stored
  try {
    const r = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lines = (await r.text()).trim().split(/\r?\n/), head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const cols = head.map((h, i) => { const m = h.match(/^([\d.]+)\s*(Mo|Month|Yr)/i); return m ? [i, /yr/i.test(m[2]) ? +m[1] : +m[1] / 12] : null; }).filter(Boolean).filter(([, y]) => y <= 2.01);
    for (const ln of lines.slice(1)) { const f = ln.split(","), [mm, dd, yy] = f[0].replace(/"/g, "").split("/"); const d = `${yy}-${mm}-${dd}`; const pts = cols.map(([i, y]) => [y, num(f[i])]).filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]); if (pts.length >= 4) ust.set(d, pts); }
    log(`Treasury ${yr}: ${[...ust.keys()].filter((d) => d.startsWith(String(yr))).length} days`);
  } catch (e) { log(`Treasury ${yr} failed: ${e.message}`); }
}
const ustDays = [...ust.keys()].sort();
const ustOn = (d) => { let k = null; for (const x of ustDays) { if (x <= d) k = x; else break; } return k ? [k, ust.get(k)] : null; }; // last New York close on or before the date
const lin = (pts, t) => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, ya] = pts[i - 1], [b, yb] = pts[i]; return ya + (yb - ya) * (t - a) / (b - a); } return pts.at(-1)[1]; };
const implied = (F, S, u, days) => ((F / S) * (1 + u / 100 * days / 365) - 1) * 365 / days * 100;

// 4. implied yields per day and tenor
const days = [...curves.keys()].filter((d) => d >= KEEP).sort();
const hist = Object.fromEntries(TENORS.map(([t]) => [t, []]));
for (const d of days) {
  const c = curves.get(d), u = ustOn(d); if (!u) continue;
  for (const [t, n] of TENORS) { const F = c.m?.[t]; if (F) hist[t].push([d, r4(implied(F, c.spot, lin(u[1], n / 365), n))]); }
}
const L = days.at(-1), c = curves.get(L), u = ustOn(L);
const rows = u ? TENORS.filter(([t]) => c.m?.[t]).map(([t, n]) => { const usd = lin(u[1], n / 365); return { t, days: n, fwd: c.m[t], pts: r4((c.m[t] - c.spot) * 1e4), usd: r4(usd), implied: r4(implied(c.m[t], c.spot, usd, n)), impliedBid: c.b?.[t] ? r4(implied(c.b[t], c.spot, usd, n)) : null, impliedAsk: c.a?.[t] ? r4(implied(c.a[t], c.spot, usd, n)) : null }; }) : [];
const out = {
  updated: Math.floor(Date.now() / 1000), date: L, spot: c.spot, ustDate: u?.[0] || null, rows,
  hist: Object.fromEntries(Object.entries(hist).filter(([, v]) => v.length)),
  src: "USD/MYR forwards: FXEmpire forward-rates page (indicative); US rates: US Treasury daily par yield curve (home.treasury.gov). Implied MYR = ((F/S)(1 + r_USD·d/365) − 1)·365/d.",
  curves: Object.fromEntries([...curves].filter(([d]) => d >= KEEP).sort()), ust: Object.fromEntries([...ust].filter(([d]) => d >= KEEP).sort()),
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${L}, spot ${c.spot}; ${rows.map((x) => `${x.t} ${x.implied}%`).join(", ")} (USD from ${u?.[0]}); ${days.length} days of history`);
