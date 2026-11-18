// Asian NDF forward curves for the FX tab: indicative outright forwards from 1 week to 2 years for
// USD/IDR, USD/TWD, USD/PHP, USD/INR, USD/KRW and USD/MYR. Offshore, these currencies trade forward as
// non-deliverable forwards (NDFs), so this is the curve that market prices off.
// Writes data/fx-fwd.json: { updated, pairs: { usdidr: { time, src, spot, rows, hist }, ... } } with the latest
// curve per pair plus one end-of-day snapshot per FX day (kept ~400 days), which the page uses for the
// "vs 1W / 1M ago" overlays and the history chart.
// Sources, tried in order for each pair; a source is accepted only if its curve passes sanity checks:
//   1. FXEmpire forward-rates page (outright bid / ask / mid per tenor; spot from the page).
//   2. Investing.com forward-rates page (bid / ask points), converted to outrights with the spot in data/fx.json.
// A pair whose sources all fail keeps its previous curve, so a deploy always goes out with the last good data.
// Usage: node scripts/fetch-fwd.mjs   [FWD_CLOSE=1 after the New York close] (run after scripts/fetch-fx.mjs, which supplies the spot)
import { writeFileSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const num = (s) => parseFloat(String(s).replace(/,/g, ""));
const OUT = "data/fx-fwd.json";

// k = key in data/fx.json; slug = URL part on both sites; inv = ticker prefix on Investing.com;
// ptsScale = Investing.com quotes points in this many units per 1 of the currency (KRW and INR in 1/100ths);
// dp = decimals kept for outrights
const PAIRS = [
  { k: "usdidr", slug: "usd-idr", inv: "USDIDR", ptsScale: 1, dp: 1 },
  { k: "usdtwd", slug: "usd-twd", inv: "USDTWD", ptsScale: 1, dp: 4 },
  { k: "usdphp", slug: "usd-php", inv: "USDPHP", ptsScale: 1, dp: 4 },
  { k: "usdinr", slug: "usd-inr", inv: "USDINR", ptsScale: 100, dp: 4 },
  { k: "usdkrw", slug: "usd-krw", inv: "USDKRW", ptsScale: 100, dp: 2 },
  { k: "usdmyr", slug: "usd-myr", inv: "USDMYR", ptsScale: 10000, dp: 4 },
];

// days = approximate tenor length used for the annualised carry; inv = labels tried on Investing.com
const TENORS = [
  { t: "1W", days: 7, fxe: "One Week", inv: ["1W", "SW"] },
  { t: "2W", days: 14, fxe: "Two Weeks", inv: ["2W"] },
  { t: "3W", days: 21, fxe: "Three Weeks", inv: ["3W"] },
  { t: "1M", days: 30, fxe: "One Month", inv: ["1M"] },
  { t: "2M", days: 61, fxe: "Two Months", inv: ["2M"] },
  { t: "3M", days: 91, fxe: "Three Months", inv: ["3M"] },
  { t: "4M", days: 122, fxe: "Four Months", inv: ["4M"] },
  { t: "5M", days: 152, fxe: "Five Months", inv: ["5M"] },
  { t: "6M", days: 182, fxe: "Six Months", inv: ["6M"] },
  { t: "9M", days: 273, fxe: "Nine Months", inv: ["9M"] },
  { t: "1Y", days: 365, fxe: "One Year", inv: ["1Y"] },
  { t: "2Y", days: 730, fxe: "Two Years", inv: ["2Y"] },
];

async function page(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  // tags to spaces, so cell values become whitespace-separated tokens whatever the markup is
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
const N = "(-?[\\d,]+(?:\\.\\d+)?)";

let fxSpot = {};
try { for (const x of JSON.parse(readFileSync("data/fx.json", "utf8")).items || []) if (x.price) fxSpot[x.k] = x.price; } catch {}

// Reject curves that are obviously broken: too few tenors, outrights far from spot, a flat copy of spot
// in every tenor (FXEmpire's USD/TWD page does this), or an implausible carry.
function check(rows, spot, min) {
  if (rows.length < min) throw new Error(`only ${rows.length} tenors parsed`);
  if (!(spot > 0)) throw new Error("no spot");
  for (const r of rows) {
    if (Math.abs(r.mid / spot - 1) > 0.25) throw new Error(`${r.t} outright ${r.mid} too far from spot ${spot}`);
    if (Math.abs((r.mid - spot) / spot * (365 / r.days)) > 0.3) throw new Error(`${r.t} carry implausible`);
  }
  const distinct = new Set(rows.map((r) => r.mid)).size;
  if (distinct < Math.ceil(rows.length / 2)) throw new Error(`curve is flat (${distinct} distinct outrights in ${rows.length} tenors)`);
}

async function fxempire(P) {
  const txt = await page(`https://www.fxempire.com/currencies/${P.slug}/forward-rates`);
  const sm = txt.match(new RegExp(`Spot Rate:?\\s*${N}`));
  const spot = sm ? num(sm[1]) : fxSpot[P.k];
  const rows = [];
  for (const T of TENORS) {
    const m = txt.match(new RegExp(`${T.fxe}\\s+${N}\\s+${N}\\s+${N}`));
    if (!m) continue;
    const [bid, ask, mid] = m.slice(1, 4).map(num);
    if (!(bid > 0 && ask >= bid && mid >= bid && mid <= ask)) continue;
    rows.push({ t: T.t, days: T.days, bid, ask, mid });
  }
  check(rows, spot, 6);
  const asof = txt.match(/As of:?\s*([0-9]{1,2}:[0-9]{2}\s+[A-Z][a-z]{2}\s+[0-9]{1,2},\s+[0-9]{4}),?\s*UTC/);
  let time = asof ? Date.parse(asof[1].replace(/^(\S+)\s+(.*)$/, "$2 $1") + " UTC") : NaN;
  if (!isFinite(time) || time > Date.now() + 3600e3) time = Date.now();
  return { rows, time: Math.floor(time / 1000), spot, src: "FXEmpire" };
}

async function investing(P) {
  const spot = fxSpot[P.k];
  if (!spot) throw new Error("no spot in data/fx.json to convert points");
  // the main site often answers GitHub's runners with 403; the regional mirrors carry the same table
  let txt = null, errs = [];
  for (const host of ["www", "in", "au", "ca", "uk", "sg"]) {
    try { txt = await page(`https://${host}.investing.com/currencies/${P.slug}-forward-rates`); if (txt.includes(`${P.inv} `)) break; errs.push(`${host}: no table`); txt = null; }
    catch (e) { errs.push(`${host}: ${e.message}`); }
  }
  if (!txt) throw new Error(errs.join(", "));
  const rows = [];
  for (const T of TENORS) {
    let m = null;
    for (const lab of T.inv) { m = txt.match(new RegExp(`${P.inv} ${lab} FWD\\s+${N}\\s+${N}`)); if (m) break; }
    if (!m) continue;
    const pb = num(m[1]) / P.ptsScale, pa = num(m[2]) / P.ptsScale;
    if (!isFinite(pb) || !isFinite(pa) || pa < pb) continue;
    rows.push({ t: T.t, days: T.days, bid: spot + pb, ask: spot + pa, mid: spot + (pb + pa) / 2 });
  }
  check(rows, spot, 5);
  return { rows, time: Math.floor(Date.now() / 1000), spot, src: "Investing.com (points on CNBC spot)" };
}

// FX day: a quote after 5pm New York belongs to the next weekday
function fxDay(ms) {
  const p = {}; new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).forEach((q) => { p[q.type] = q.value; });
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  if (+p.hour >= 17) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
// the file used to hold USD/IDR only, at the top level
const prevPairs = prev?.pairs || (prev?.rows ? { usdidr: prev } : {});

// Live runs (deploy) file the curve under the FX day now trading. The after-close run in ta-data.yml sets
// FWD_CLOSE=1 so the curve is saved as the close of the day that just ended; that is the copy committed to the repo.
let day = fxDay(Date.now());
if (process.env.FWD_CLOSE) { const d = new Date(day + "T00:00:00Z"); do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6); day = d.toISOString().slice(0, 10); }

const pairs = {};
let okCount = 0;
for (const P of PAIRS) {
  const old = prevPairs[P.k];
  let got = null;
  for (const [name, fn] of [["FXEmpire", fxempire], ["Investing.com", investing]]) {
    try { got = await fn(P); log(P.k, name, "ok:", got.rows.map((r) => `${r.t} ${r.mid.toFixed(P.dp)}`).join(", ")); break; }
    catch (e) { log(P.k, name, "failed:", e.message); summary(`- ${P.k} forwards: ${name} failed (${e.message})`); }
  }
  if (!got) { if (old) pairs[P.k] = old; log(P.k, "no source worked; kept previous curve"); continue; }
  okCount++;
  const r_ = (v) => +v.toFixed(P.dp);
  const spot = r_(got.spot);
  const rows = got.rows.map((r) => {
    const pts = r.mid - got.spot;
    return { t: r.t, days: r.days, bid: r_(r.bid), ask: r_(r.ask), mid: r_(r.mid), pts: +pts.toFixed(P.dp + 1),
      carry: +((pts / got.spot) * (365 / r.days) * 100).toFixed(2) }; // % a year, ≈ local minus USD rates
  });
  const hist = (old?.hist || []).filter((h) => h.d !== day);
  hist.push({ d: day, spot, m: Object.fromEntries(rows.map((r) => [r.t, r.mid])) });
  hist.sort((a, b) => (a.d < b.d ? -1 : 1));
  pairs[P.k] = { time: got.time, src: got.src, spot, rows, hist: hist.slice(-400) };
  const one = rows.find((r) => r.t === "1M");
  summary(`- ${P.k} forwards (${got.src}): spot ${spot}${one ? `, 1M ${one.mid} (${one.carry}% a year)` : ""} · ${hist.length} daily snapshots`);
}
if (!okCount && !Object.keys(pairs).length) { log("forwards: nothing fetched and no previous file; nothing written"); process.exit(0); }
mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: Math.floor(Date.now() / 1000), pairs }));
log(`forwards: ${okCount}/${PAIRS.length} pairs refreshed`);
