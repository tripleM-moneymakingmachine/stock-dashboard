// KRW interest rate swap (IRS, fixed vs 91-day CD) closing rates by tenor, from the two Seoul money brokers' public pages:
//   Korea Money Brokerage (kmbco.com, 한국자금중개): daily closes for 1–10Y (deri_rate.do; period query by POST)
//   Seoul Money Brokerage (smbs.biz, 서울외국환중개): receive / mid / pay for 1–20Y on one date (IRS.jsp; date by POST)
// Keeps a running history in data/korea-irs.json, merged on each run. While a broker's history is shorter than
// ~13 months it back-fills: Korea Money Brokerage by period (paged), Seoul Money Brokerage one business day per
// request (capped per run, so a full year builds over a few runs).
// Usage: node scripts/fetch-korea-irs.mjs [--probe]   (--probe also saves raw responses to data/korea-irs-probe/)
import fs from "node:fs";

const OUT = "data/korea-irs.json";
const PROBE = process.argv.includes("--probe");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TEN = [1, 2, 3, 4, 5, 7, 10, 12, 15, 20];
const KMB = "https://www.kmbco.com/kor/rate/deri_rate.do";
const SMBS = "http://www.smbs.biz/Exchange/IRS.jsp";
const BACK_DAYS = 400;          // history wanted (a year plus a margin for the 1Y change)
const SMBS_MAX_REQ = +(process.env.SMBS_MAX_REQ || 160); // Seoul Money Brokerage day-requests per run

const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const src = old.src || {}; src.kmb ||= {}; src.smbs ||= {}; // src.<broker>[tenor] = [[date, rate], ...]
const probe = (name, body) => { if (!PROBE) return; fs.mkdirSync("data/korea-irs-probe", { recursive: true }); fs.writeFileSync(`data/korea-irs-probe/${name}`, body); };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function get(url, form) {
  for (let i = 0; i < 3; i++) {
    try {
      const opt = { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", Referer: url }, signal: AbortSignal.timeout(30000) };
      if (form) { opt.method = "POST"; opt.body = new URLSearchParams(form).toString(); opt.headers["Content-Type"] = "application/x-www-form-urlencoded"; }
      const r = await fetch(url, opt);
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get("content-type") || "", head = buf.subarray(0, 3000).toString("latin1");
      return new TextDecoder(/euc-kr|ks_c_5601|cp949/i.test(ct + head) ? "euc-kr" : "utf-8").decode(buf);
    } catch (e) { if (i === 2) throw e; await sleep(3000 * (i + 1)); }
  }
}
const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const cells = (tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => strip(m[1]));
const rowsOf = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cells(m[1]));
const num = (s) => { const v = parseFloat(String(s).replace(/,/g, "")); return isFinite(v) && v > -5 && v < 30 ? v : null; };
const put = (b, t, d, v) => { if (v == null) return; const s = (src[b][t] ||= []); const i = s.findIndex(([x]) => x === d); if (i >= 0) s[i][1] = v; else s.push([d, v]); };
const iso = (dt) => dt.toISOString().slice(0, 10);
const today = iso(new Date(Date.now() + 9 * 3600e3)); // Seoul date
const minus = (d, n) => iso(new Date(Date.parse(d) - n * 864e5));
const has = (b, t) => new Set((src[b][t] || []).map(([d]) => d));
const firstDate = (b, t) => (src[b][t] || []).map(([d]) => d).sort()[0];

// ---------- Korea Money Brokerage: "전송일 | 1Y | 2Y | 3Y | 4Y | 5Y | 7Y | 10Y", one row per date (YYYY/MM/DD) ----------
function parseKmb(html) {
  let hdr = null; const dates = [];
  for (const c of rowsOf(html)) {
    if (c.some((x) => /^1Y$/i.test(x)) && c.some((x) => /^10Y$/i.test(x))) { hdr = c.map((x) => { const m = /^(\d+)Y$/i.exec(x); return m ? +m[1] : null; }); continue; }
    const dm = /^(\d{4})[\/.-](\d{2})[\/.-](\d{2})$/.exec(c[0] || "");
    if (!hdr || !dm) continue;
    const d = `${dm[1]}-${dm[2]}-${dm[3]}`;
    c.forEach((x, i) => { const t = hdr[i]; if (t && TEN.includes(t)) put("kmb", t, d, num(x)); });
    dates.push(d);
  }
  return dates;
}
const kmbPages = (html) => Math.max(1, ...[...html.matchAll(/pageNav\(\s*'?(\d+)'?/g)].map((m) => +m[1]));

// ---------- Seoul Money Brokerage: values are written by small decoder scripts, e.g. d1('%_Z31%_Z59') = "1Y" ----------
const unmask = (html) => html.replace(/<script>\s*d\d\(\s*'([^']*)'\s*\);?\s*<\/script>/g, (_, s) => s.replace(/%u?_[A-Z]([0-9a-fA-F]{2,4})/g, (__, h) => String.fromCharCode(parseInt(h, 16))));
function parseSmbsDay(raw) {
  const html = unmask(raw);
  const i = html.indexOf("IRS RATE 조회 결과");
  const dm = [...strip(html.slice(Math.max(0, i - 3000), i)).matchAll(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)].at(-1);
  if (!dm) return null;
  const d = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
  let n = 0;
  for (const c of rowsOf(html)) {
    const m = /^(\d+)Y$/i.exec(c[0] || ""); if (!m || c.length < 4) continue;
    const t = +m[1]; if (!TEN.includes(t)) continue;
    const mid = num(c[2]); if (mid == null) continue;
    put("smbs", t, d, mid); n++;
  }
  return n ? d : null;
}
const smbsForm = (d) => { const [y, m, dd] = d.split("-"); const [sy, sm, sd] = minus(d, 30).split("-");
  return { StrSch_sYear: sy, StrSch_sMonth: sm, StrSch_sDay: sd, StrSch_eYear: y, StrSch_eMonth: m, StrSch_eDay: dd, StrSch_Year: y, StrSch_Month: m, StrSch_Day: dd,
    StrSchFull: `${sy}.${sm}.${sd}`, StrSchFull2: `${y}.${m}.${dd}`, StrSchFull3: `${y}.${m}.${dd}` }; };

const log = [];
// latest pages
try { const h = await get(KMB); probe("kmb.html", h); log.push(`KMB latest: ${parseKmb(h).length} dates`); } catch (e) { log.push(`KMB failed: ${e.message}`); }
try { const h = await get(SMBS); probe("smbs.html", h); log.push(`SMBS latest: ${parseSmbsDay(h) || "no table"}`); } catch (e) { log.push(`SMBS failed: ${e.message}`); }

// back-fill Korea Money Brokerage by period (POST, 10 rows a page)
try {
  const f = firstDate("kmb", 10), want = minus(today, BACK_DAYS);
  if (!f || f > minus(want, -7)) {
    const form = { d_type: "IRS", s_date: want, e_date: today, term: "" };
    const h1 = await get(KMB, form); probe("kmb-period.html", h1);
    // pages: POST cPage with search_value "start/end/IRS" (as the page's pageNav does); stop when a page adds nothing new
    const d1 = parseKmb(h1); let got = d1.length, p = 1; const prev = new Set(d1);
    while (++p <= 45) {
      await sleep(250);
      const h = await get(KMB, { cPage: String(p), search_value: `${want}/${today}/IRS` });
      if (p === 2) probe("kmb-page2.html", h);
      const ds = parseKmb(h).filter((d) => !prev.has(d)); if (!ds.length) break;
      ds.forEach((d) => prev.add(d)); got += ds.length;
    }
    log.push(`KMB back-fill ${want}→${today}: ${p - 1} pages (of ${kmbPages(h1)} listed), ${got} rows, history now from ${firstDate("kmb", 10)}`);
  }
} catch (e) { log.push(`KMB back-fill failed: ${e.message}`); }

// back-fill Seoul Money Brokerage one weekday at a time, newest gaps first (holidays come back as another date or empty)
try {
  const seen = has("smbs", 20), tried = new Set(old.smbsTried || []);
  const days = []; for (let k = 1; k <= BACK_DAYS; k++) { const d = minus(today, k), wd = new Date(d).getUTCDay(); if (wd && wd < 6 && !seen.has(d) && !tried.has(d)) days.push(d); }
  let n = 0, ok = 0;
  for (const d of days.slice(0, SMBS_MAX_REQ)) {
    const h = await get(SMBS, smbsForm(d)); n++;
    if (n === 1) probe("smbs-date.html", h);
    const got = parseSmbsDay(h);
    if (got && got > d) { log.push(`SMBS returned ${got} when asked for ${d}; date query not working, back-fill stopped`); break; }
    if (got === d) ok++; else tried.add(d); // no close that day (holiday)
    await sleep(200);
  }
  old.smbsTried = [...tried].filter((d) => d >= minus(today, BACK_DAYS + 30)).sort();
  if (n) log.push(`SMBS back-fill: ${n} requests, ${ok} days added, history now from ${firstDate("smbs", 20)}`);
} catch (e) { log.push(`SMBS back-fill failed: ${e.message}`); }

// Combined series: Korea Money Brokerage closes for 1–10Y, Seoul Money Brokerage mid where KMB has no close for that date
// or tenor (12Y, 15Y, 20Y, and any day KMB missed).
const tenors = {};
for (const b of ["kmb", "smbs"]) for (const t in src[b]) src[b][t].sort((x, y) => x[0].localeCompare(y[0]));
for (const t of TEN) {
  const m = new Map(src.smbs[t] || []); for (const [d, v] of src.kmb[t] || []) m.set(d, v);
  const s = [...m].sort((a, b) => a[0].localeCompare(b[0]));
  if (s.length) tenors[t] = s;
}
const last = Object.values(tenors).map((s) => s.at(-1)[0]).sort().at(-1);
if (!last) { console.error(log.join("\n")); console.error("No IRS data; keeping the committed file."); process.exit(1); }
const out = {
  updated: Math.floor(Date.now() / 1000),
  date: last,
  note: "KRW IRS (fixed vs 91-day CD) closing rates, % a year. 1–10Y: Korea Money Brokerage closes; 12–20Y and gaps: Seoul Money Brokerage mid.",
  tenors,
  src,
  smbsTried: old.smbsTried || [],
};
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(log.join("\n"), `\nLatest ${last}:`, TEN.map((t) => `${t}Y ${tenors[t]?.at(-1)?.[0] === last ? tenors[t].at(-1)[1] : "–"}`).join(" "));
