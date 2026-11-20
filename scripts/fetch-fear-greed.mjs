// Stocks tab: Nasdaq fear & greed factor (panel above the previous-session recap).
// Writes data/fear-greed.json from Yahoo daily closes for the Nasdaq Composite (^IXIC), the VIX (^VIX) and gold
// futures (GC=F). The window starts on 2024-10-01 and, once it is longer than three years, rolls (last 805 sessions):
//   { updated, session, src, window, latest, comp, d, fg, ndq, vix, gold, n20, g20, episodes, zones, putcall }
// The factor (0 = maximum fear, 100 = maximum greed) is the equal-weighted average of six scores. Each score is the
// percentile of today's reading within the whole window, so earlier values are ranked with hindsight:
//   Momentum        Nasdaq close vs its 50-day average
//   Drawdown        close vs the highest close of the last 252 sessions (at least 50)
//   Realised vol    20-session standard deviation of daily returns, annualised (inverted)
//   VIX level       VIX close (inverted)
//   VIX spike       VIX vs its own 50-day average (inverted)
//   Safe-haven bid  Nasdaq 20-session return minus gold's (low = money prefers gold)
// episodes: every Nasdaq decline of 8% or more from a running peak, with gold's move over the same span.
// zones: the Nasdaq's average return over the next 20 sessions by the factor's zone on the starting day.
// putcall is not fetched (no free daily history); it is kept across rebuilds and edited by hand or by the recap task.
// Usage: node scripts/fetch-fear-greed.mjs            (Yahoo)
//        node scripts/fetch-fear-greed.mjs DIR        (offline: DIR/ixic.csv, vix.csv, gold.csv with "date,price" rows)
// A failed fetch leaves the committed file untouched.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const OUT = "data/fear-greed.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const nyDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const r1 = (v) => +v.toFixed(1), r2 = (v) => +v.toFixed(2);

let old = {};
try { old = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

// ---------- inputs: { "YYYY-MM-DD": close } ----------
async function yahoo(sym) {
  let cookie = "", crumb = "";
  const get = async (url, headers = {}) => {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  try {
    const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(10000) });
    cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    if (cookie) crumb = await (await get("https://query2.finance.yahoo.com/v1/test/getcrumb", { Cookie: cookie })).text();
  } catch (e) { console.log("crumb:", e.message); }
  const q = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
  let err;
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const r = await get(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1d&includePrePost=false${q}`,
        { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) });
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp?.length) throw new Error("empty");
      const c = res.indicators.quote[0].close, out = {};
      res.timestamp.forEach((t, i) => { if (c[i] != null) out[nyDate(t * 1000)] = c[i]; });
      return out;
    } catch (e) { err = e; }
  }
  throw err;
}
function csv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").trim().split("\n").slice(1)) { const [d, p] = line.split(","); out[d] = +p; }
  return out;
}

const dir = process.argv[2];
let ix, vx, gd;
try {
  if (dir) { ix = csv(`${dir}/ixic.csv`); vx = csv(`${dir}/vix.csv`); gd = csv(`${dir}/gold.csv`); }
  else { ix = await yahoo("^IXIC"); vx = await yahoo("^VIX"); gd = await yahoo("GC=F"); }
} catch (e) {
  console.log("fetch failed, keeping the committed file:", e.message);
  summary(`Fear & greed: fetch failed (${e.message}); kept the committed file.`);
  process.exit(0);
}

// ---------- align on Nasdaq sessions; VIX and gold carry their last close forward ----------
const FROM = "2024-10-01", MAXN = 805;             // 756 scored sessions + 49 of warm-up
const D = Object.keys(ix).sort().filter((d) => d >= FROM).slice(-MAXN);
const fill = (m) => { let last = null; const keys = Object.keys(m).sort(); let k = 0; return D.map((d) => { while (k < keys.length && keys[k] <= d) last = m[keys[k++]]; return last; }); };
const C = D.map((d) => ix[d]), V = fill(vx), G = fill(gd);
const n = D.length;
if (n < 300 || V[49] == null || G[20] == null) {
  console.log("not enough history, keeping the committed file"); summary("Fear & greed: not enough history; kept the committed file."); process.exit(0);
}

const mean = (a, i, w) => { let s = 0; for (let j = i - w + 1; j <= i; j++) s += a[j]; return s / w; };
const ret = C.map((c, i) => (i ? c / C[i - 1] - 1 : null));
const START = 49;                                   // first day with a 50-day average
const raw = { mom: [], dd: [], rv: [], vix: [], vrel: [], haven: [] }, n20 = [], g20 = [];
for (let i = START; i < n; i++) {
  raw.mom.push(C[i] / mean(C, i, 50) - 1);
  let hi = -Infinity; for (let j = Math.max(0, i - 251); j <= i; j++) hi = Math.max(hi, C[j]);
  raw.dd.push(C[i] / hi - 1);
  const m = mean(ret, i, 20); let ss = 0; for (let j = i - 19; j <= i; j++) ss += (ret[j] - m) ** 2;
  raw.rv.push(Math.sqrt(ss / 19) * Math.sqrt(252) * 100);
  raw.vix.push(V[i]);
  raw.vrel.push(V[i] / mean(V, i, 50) - 1);
  const a = C[i] / C[i - 20] - 1, b = G[i] / G[i - 20] - 1;
  n20.push(a * 100); g20.push(b * 100); raw.haven.push(a - b);
}
const N = n - START;
// percentile rank within the window (ties share the average rank); inv flips it so that 100 is always greed
function pct(a, inv) {
  const idx = a.map((v, i) => i).sort((x, y) => a[x] - a[y]), rk = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
    const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) rk[idx[k]] = r; i = j + 1;
  }
  return rk.map((r) => (inv ? 1 - r / a.length : r / a.length) * 100);
}
const S = [
  ["Momentum", pct(raw.mom), (i) => `Nasdaq ${sgn(raw.mom[i] * 100)}% vs 50-day average`],
  ["Drawdown", pct(raw.dd), (i) => `${sgn(raw.dd[i] * 100)}% from 252-day high`],
  ["Realised vol", pct(raw.rv, true), (i) => `${raw.rv[i].toFixed(1)}% annualised, 20 sessions`],
  ["VIX level", pct(raw.vix, true), (i) => `VIX ${raw.vix[i].toFixed(2)}`],
  ["VIX spike", pct(raw.vrel, true), (i) => `VIX ${sgn(raw.vrel[i] * 100)}% vs 50-day average`],
  ["Safe-haven bid", pct(raw.haven), (i) => `Nasdaq ${sgn(n20[i])}% vs gold ${sgn(g20[i])}%, 20 sessions`],
];
function sgn(v) { return (v > 0 ? "+" : "") + v.toFixed(1); }
const fg = Array.from({ length: N }, (_, i) => S.reduce((s, c) => s + c[1][i], 0) / S.length);
const d = D.slice(START), c = C.slice(START), v = V.slice(START), g = G.slice(START);

// ---------- zones and what followed ----------
const ZONES = [["Extreme fear", "0-25", 25], ["Fear", "25-45", 45], ["Neutral", "45-55", 55], ["Greed", "55-75", 75], ["Extreme greed", "75-100", 100]];
const zoneOf = (x) => ZONES.find((z) => x <= z[2])[0];
const zones = ZONES.map(([name, range]) => {
  let days = 0, k = 0, sum = 0, up = 0;
  for (let i = 0; i < N; i++) {
    if (zoneOf(fg[i]) !== name) continue;
    days++;
    if (i + 20 < N) { const f = c[i + 20] / c[i] - 1; k++; sum += f; if (f > 0) up++; }
  }
  return [name, range, days, k ? r1(sum / k * 100) + 0 : null, k ? Math.round(up / k * 100) : null];
});

// ---------- selloffs of 8% or more from a running peak ----------
const episodes = [];
{
  let pk = 0, tr = -1;
  const close = (open) => {
    if (tr < 0 || c[tr] / c[pk] - 1 > -0.08) return;
    let vmax = 0, fmin = 101; for (let j = pk; j <= tr; j++) { vmax = Math.max(vmax, v[j]); fmin = Math.min(fmin, fg[j]); }
    episodes.push({ peak: d[pk], trough: d[tr], days: tr - pk, ndq: r1((c[tr] / c[pk] - 1) * 100), gold: r1((g[tr] / g[pk] - 1) * 100),
      vixmax: r2(vmax), fgpeak: Math.round(fg[pk]), fgmin: Math.round(fmin), ...(open ? { open: true } : {}) });
  };
  for (let i = 1; i < N; i++) {
    if (c[i] >= c[pk]) { close(false); pk = i; tr = -1; }
    else if (tr < 0 || c[i] < c[tr]) tr = i;
  }
  close(true);
}

const L = N - 1;
const out = {
  updated: new Date().toISOString(),
  session: d[L],
  src: dir ? "daily closes from Financial Modeling Prep (^IXIC, ^VIX, GCUSD)" : "Yahoo Finance daily closes (^IXIC, ^VIX, GC=F)",
  window: { from: d[0], to: d[L], n: N },
  latest: { fg: Math.round(fg[L]), zone: zoneOf(fg[L]), wk: L >= 5 ? Math.round(fg[L] - fg[L - 5]) : null, ndq: r2(c[L]),
    dd: r1(raw.dd[L] * 100), vix: r2(v[L]), rv: r1(raw.rv[L]), n20: r1(n20[L]), g20: r1(g20[L]) },
  comp: S.map(([name, s, txt]) => [name, Math.round(s[L]), txt(L)]),
  d, fg: fg.map(r1), ndq: c.map(r2), vix: v.map(r2), gold: g.map(r1), n20: n20.map(r1), g20: g20.map(r1),
  episodes, zones,
  ...(old.putcall ? { putcall: old.putcall } : {}),
};
writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`fear & greed ${out.latest.fg} (${out.latest.zone}) for ${out.session}; ${N} sessions, ${episodes.length} selloffs`);
summary(`Fear & greed: **${out.latest.fg}** (${out.latest.zone}) for ${out.session}.`);
