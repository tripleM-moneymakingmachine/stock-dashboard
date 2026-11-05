// China tab "CMU bonds": every outstanding USD and offshore yuan (CNH, listed by CMU as CNY) debt instrument lodged
// with Hong Kong's Central Moneymarkets Unit — the settlement system Southbound Bond Connect uses.
//  - Bond list: HKMA Open API, List of CMU Instruments (issue, issuer, ISIN, currency, coupon, dates, size).
//    CMU publishes no prices, so there is no market yield. For each bond the dashboard shows its coupon (= yield to
//    maturity if bought at par) and the reference curve yield at its remaining term, plus the coupon's spread to it:
//    USD → US Treasury daily par curve (home.treasury.gov); CNH → CCDC AAA commercial bank NCD curve up to 1Y and the
//    CCDC China Development Bank curve beyond (both from data/china.json).
// Anything that fails keeps the previous file. Writes data/cmu-bonds.json. Usage: node scripts/fetch-cmu-bonds.mjs
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const API = "https://api.hkma.gov.hk/public/debt-securities-settlement-system/operational-information/list-of-cmu-instruments";
const OUT = "data/cmu-bonds.json";
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });
const yrs = (d) => (Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / (365.25 * 864e5);
const num = (v) => (v === "" || v == null || !isFinite(+v) ? null : +v);
const interp = (pts, x) => {
  if (!pts?.length || !isFinite(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts.at(-1)[1];
};

let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

async function getJson(url) {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (a === 3) throw e; await new Promise((s) => setTimeout(s, 3000 * a)); }
  }
}

// Every CMU instrument, page by page (the API caps the page size, so step by what each page returns)
async function allInstruments() {
  const rows = [];
  let total = null;
  for (let page = 0; page < 400; page++) {
    const j = await getJson(`${API}?pagesize=1000&offset=${rows.length}`);
    if (j?.header?.success === false) throw new Error(j.header.err_msg || "HKMA API error");
    const recs = j?.result?.records || [];
    total = j?.result?.datasize ?? total;
    if (!recs.length) break;
    rows.push(...recs);
    if (total != null && rows.length >= total && recs.length < 1000) break;
  }
  return rows;
}

// Latest US Treasury daily par yield curve: [[years, yield %], ...]
async function ustCurve() {
  for (const yr of [today.slice(0, 4), String(+today.slice(0, 4) - 1)]) {
    const r = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) continue;
    const lines = (await r.text()).trim().split(/\r?\n/);
    if (lines.length < 2) continue;
    const head = lines[0].split(",").map((s) => s.replace(/"/g, "").trim());
    const ten = head.map((h) => { const m = h.match(/^([\d.]+)\s*(Mo|Month|Yr|Year)/i); return m ? +m[1] / (/^m/i.test(m[2]) ? 12 : 1) : null; });
    const rows = lines.slice(1).map((l) => l.split(","));
    rows.sort((a, b) => Date.parse(b[0]) - Date.parse(a[0])); // newest first
    const row = rows[0];
    const pts = ten.map((t, i) => (t != null && isFinite(+row[i]) && row[i] !== "" ? [t, +row[i]] : null)).filter(Boolean).sort((a, b) => a[0] - b[0]);
    const [m, d, y] = row[0].split("/");
    if (pts.length >= 6) return { date: `${y}-${m}-${d}`, pts };
  }
  return null;
}

let raw;
try { raw = await allInstruments(); }
catch (e) { console.log("HKMA fetch failed:", e.message, "— keeping the committed file"); summary(`CMU bonds: HKMA fetch failed (${e.message}), kept previous file`); process.exit(0); }
console.log(`HKMA: ${raw.length} CMU instruments`);

let ust = null;
try { ust = await ustCurve(); } catch (e) { console.log("UST curve failed:", e.message); }
if (!ust && prev?.ref?.usd) ust = prev.ref.usd;
let china = {};
try { china = JSON.parse(readFileSync("data/china.json", "utf8")); } catch {}
const ncd = china.ncd?.curve, cdb = china.pb?.cdb?.curve;
const cnRef = (t) => (t <= 1 && ncd?.pts?.length ? interp(ncd.pts, t) : interp(cdb?.pts, t));

const EFBN = /^EXCHANGE FUND|^EFB|^EFN|^HKSAR GOVT|^HONG KONG SAR GOVERNMENT/i;
const bonds = [];
for (const r of raw) {
  const ccy = String(r.issue_ccy || "").toUpperCase();
  if (!["USD", "CNY", "CNH"].includes(ccy)) continue;
  if (!r.maturity_date || r.maturity_date < today) continue;
  if (EFBN.test(r.issue_description || "")) continue;
  const ttm = yrs(r.maturity_date);
  const cpn = num(r.coupon_rate);
  const frn = /\bFRN\b|FLOAT/i.test(r.issue_description || "");
  const zero = cpn === 0;
  const tenor = r.issue_date ? (Date.parse(r.maturity_date) - Date.parse(r.issue_date)) / (365.25 * 864e5) : null;
  const ref = ccy === "USD" ? interp(ust?.pts, ttm) : cnRef(ttm);
  bonds.push({
    isin: r.isin || null, code: r.issue_number || null, name: r.issue_description || "", issuer: r.issuer || "",
    ccy: ccy === "USD" ? "USD" : "CNH", cpn, frn, zero,
    type: zero ? "Discount note" : frn ? "FRN" : tenor != null && tenor <= 1.05 ? "CD / note ≤1Y" : "Bond",
    issue: r.issue_date || null, mat: r.maturity_date, call: r.call_put_option_date || null,
    next: r.next_coupon_date || null, freq: num(r.int_pay_freq),
    size: num(r.issue_size), out: num(r.outstanding_amount), minAmt: num(r.min_tradable_amount),
    ttm: +ttm.toFixed(3),
    yld: zero ? null : cpn, // yield at par = coupon (FRNs: current coupon)
    ref: ref == null ? null : +ref.toFixed(4),
    spr: zero || cpn == null || ref == null ? null : +((cpn - ref) * 100).toFixed(1),
  });
}
bonds.sort((a, b) => a.ccy.localeCompare(b.ccy) || a.mat.localeCompare(b.mat));

if (!bonds.length) { console.log("no USD/CNH bonds parsed — keeping the committed file"); process.exit(0); }
const out = {
  updated: new Date().toISOString(),
  asOf: today,
  totalCmu: raw.length,
  ref: { usd: ust, cnh: { ncd: ncd ? { date: ncd.date } : null, cdb: cdb ? { date: cdb.date } : null } },
  src: "HKMA Open API, List of CMU Instruments (instrument details; no prices). Reference curves: US Treasury daily par yield curve (home.treasury.gov); ChinaBond (CCDC) AAA commercial bank NCD curve (≤1Y) and China Development Bank curve (>1Y).",
  bonds,
};
writeFileSync(OUT, JSON.stringify(out));
const n = (c) => bonds.filter((b) => b.ccy === c).length;
console.log(`wrote ${OUT}: ${bonds.length} bonds (USD ${n("USD")}, CNH ${n("CNH")})`);
summary(`CMU bonds: ${bonds.length} USD/CNH instruments (USD ${n("USD")}, CNH ${n("CNH")}) of ${raw.length} in CMU`);
