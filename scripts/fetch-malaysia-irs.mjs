// Malaysia tab, MYR interest rate swaps (data/malaysia-irs.json): onshore ringgit IRS against 3-month KLIBOR, 1, 3, 5,
// 7 and 10 years, from Hong Leong Bank's daily "Fixed Income Daily Market Snapshot" (a public PDF, one per Kuala Lumpur
// business day, at a date-based URL). Each run reads the latest days and back-fills older ones (a limited number of PDFs
// per run), so the history grows to a few years. The 2, 4, 6, 8 and 9-year points are interpolated on the page and
// labelled as estimates. Offshore non-deliverable IRS (NDIRS) has no free public source and is not included.
// Needs pdftotext (poppler-utils). Usage: node scripts/fetch-malaysia-irs.mjs. Anything that fails keeps the previous file.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "data/malaysia-irs.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BUDGET = +(process.env.MY_IRS_BACKFILL || 160);
const KEEP_FROM = new Date(Date.now() - 3 * 366 * 864e5).toISOString().slice(0, 10);
const log = (...a) => console.log(...a);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const TEN = [1, 3, 5, 7, 10];
const isWk = (d) => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay());
const prevWk = (d) => { let t = Date.parse(d); do t -= 864e5; while (!isWk(new Date(t).toISOString().slice(0, 10))); return new Date(t).toISOString().slice(0, 10); };
const url = (d) => `https://hlb.com.my/content/dam/hlb/my/docs/pdf/Global_Markets/fixed-income-daily-market-snapshot/${d.slice(0, 4)}/${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}.pdf`;
const tmp = mkdtempSync(join(tmpdir(), "hlb-"));
const T0 = Date.now(), MAX_MS = +(process.env.MY_IRS_MAX_MS || 180000); // keep the step short; the back-fill resumes next run
let errs = 0, logged = 0;

const days = new Map(Object.entries(prev.days || {})); // date → { 1: [y, chgBp], ..., klibor: y }
const miss = new Set(prev.miss || []);
let dumped = false;
function parse(txt) {
  const i = txt.search(/\bIRS\b[\s\S]{0,40}Closing/i); if (i < 0) return null;
  const seg = txt.slice(i, i + 600);
  const o = {};
  for (const m of seg.matchAll(/(\d{1,2})-yr\s+(\d\.\d{2,3})\s+\(?(-?\d+)\)?/gi)) if (TEN.includes(+m[1]) && !(m[1] in o)) o[m[1]] = [+m[2], +m[3]];
  if (Object.keys(o).length < 4) { // columns extracted one after another: labels, then closes, then changes
    const labs = [...seg.matchAll(/(\d{1,2})-yr/gi)].map((m) => +m[1]).filter((t) => TEN.includes(t)).slice(0, 5);
    const nums = [...seg.replace(/(\d{1,2})-yr/gi, " ").matchAll(/\(?-?\d+(?:\.\d+)?\)?/g)].map((m) => m[0]);
    const ys = nums.filter((x) => /^\d\.\d{2,3}$/.test(x)).slice(0, labs.length), cs = nums.filter((x) => /^\(?-?\d{1,3}\)?$/.test(x)).slice(0, labs.length);
    if (labs.length >= 4 && ys.length === labs.length) labs.forEach((t, k) => { o[t] = [+ys[k], cs[k] != null ? +cs[k].replace(/[()]/g, "") * (/\(/.test(cs[k]) ? -1 : 1) : null]; });
  }
  const ok = Object.values(o).filter(([y]) => y > 0.5 && y < 10).length >= 4;
  if (!ok) { if (!dumped) { dumped = true; log(`  IRS block not parsed; text: ${seg.replace(/\s+/g, " ").slice(0, 400)}`); } return null; }
  const k = txt.match(/3M\s*KLIBOR\s+(\d\.\d{2,3})/i) || txt.match(/KLIBOR[^\d]{0,20}3[- ]?(?:mth|month|M)\s+(\d\.\d{2,3})/i);
  if (k) o.klibor = +k[1];
  return o;
}
async function take(d) {
  try {
    const r = await fetch(url(d), { headers: { "User-Agent": UA, Accept: "application/pdf,*/*" }, signal: AbortSignal.timeout(15000) });
    if (logged++ < 3) log(`  ${url(d)}: HTTP ${r.status} ${r.headers.get("content-type")}`);
    if (r.status === 404) return "miss";
    if (!r.ok) { errs++; return "err"; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.slice(0, 4).toString() !== "%PDF") return "miss";
    const f = join(tmp, `${d}.pdf`); writeFileSync(f, buf);
    const txt = execFileSync("pdftotext", [f, "-"], { encoding: "utf8" });
    const o = parse(txt); if (!o) return "miss";
    days.set(d, o); return "ok";
  } catch (e) { errs++; if (errs <= 3) log(`  ${d}: ${e.message}`); return "err"; }
}

// latest days: today (KL) back to the last stored day
const todayKL = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
let d = isWk(todayKL) ? todayKL : prevWk(todayKL), n = 0, budget = BUDGET;
const last = [...days.keys()].sort().at(-1);
for (let i = 0; i < 10 && budget > 0 && errs < 5; i++, d = prevWk(d)) {
  if (last && d <= last) break;
  budget--; const r = await take(d); if (r === "ok") n++; else if (r === "miss" && d < todayKL) miss.add(d);
}
log(`HLB snapshot: ${n} new latest day(s); stored ${days.size}`);
// back-fill
let back = 0, gap = 0; d = [...days.keys()].sort()[0] || prevWk(todayKL);
if (!prev.backStop) {
  while (budget > 0 && d > KEEP_FROM && Date.now() - T0 < MAX_MS && errs < 8) {
    d = prevWk(d); if (miss.has(d) || days.has(d)) continue;
    budget--; const r = await take(d);
    if (r === "ok") { back++; gap = 0; } else if (r === "miss") { miss.add(d); if (++gap >= 25) { log(`HLB back-fill: 25 weekdays without a snapshot before ${d}; stopping`); break; } }
  }
}
log(`HLB back-fill: +${back} days, earliest ${[...days.keys()].sort()[0]}`);
rmSync(tmp, { recursive: true, force: true });
if (!days.size) { log("No IRS data; not writing."); process.exit(0); }

const keys = [...days.keys()].sort();
const series = Object.fromEntries(TEN.map((t) => [t, keys.filter((k) => days.get(k)[t]).map((k) => [k, days.get(k)[t][0]])]));
const klibor = keys.filter((k) => days.get(k).klibor != null).map((k) => [k, days.get(k).klibor]);
const L = days.get(keys.at(-1));
const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "Hong Leong Bank, Fixed Income Daily Market Snapshot (MYR IRS closing rates, 3-month KLIBOR); compiled by the dashboard",
  date: keys.at(-1), latest: Object.fromEntries(TEN.filter((t) => L[t]).map((t) => [t, { y: L[t][0], chg: L[t][1] }])), klibor3m: L.klibor ?? null,
  tenors: series, klibor, ndirs: null,
  days: Object.fromEntries(keys.map((k) => [k, days.get(k)])), miss: [...miss].filter((x) => x >= KEEP_FROM).sort(), backStop: gap >= 25 ? d : prev.backStop || null,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${keys.length} days ${keys[0]} – ${keys.at(-1)}; latest ${TEN.map((t) => `${t}Y ${L[t]?.[0]}`).join(", ")}`);
