// KRW interest rate swap (IRS, vs 91-day CD) closing rates by tenor, from the two Seoul money brokers' public pages:
//   Korea Money Brokerage (kmbco.com, 한국자금중개): daily closes for 1–10Y, last 10 sessions on the page
//   Seoul Money Brokerage (smbs.biz, 서울외국환중개): receive / mid / pay for 1–20Y, latest session
// Keeps a running history in data/korea-irs.json (merged on each run), so day / week / month / year changes build up.
// Usage: node scripts/fetch-korea-irs.mjs [--probe]   (--probe also saves the raw pages to data/korea-irs-probe/)
import fs from "node:fs";

const OUT = "data/korea-irs.json";
const PROBE = process.argv.includes("--probe");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TEN = [1, 2, 3, 4, 5, 7, 10, 12, 15, 20];

const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const src = old.src || { kmb: {}, smbs: {} }; // src.<broker>[tenor] = [[date, rate], ...]

async function get(url, opt = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get("content-type") || "", head = buf.subarray(0, 2000).toString("latin1");
      const enc = /euc-kr|ks_c_5601|cp949/i.test(ct + head) ? "euc-kr" : "utf-8";
      return new TextDecoder(enc).decode(buf);
    } catch (e) { if (i === 2) throw e; await new Promise((s) => setTimeout(s, 3000 * (i + 1))); }
  }
}
const cells = (tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
const rowsOf = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cells(m[1]));
const num = (s) => { const v = parseFloat(String(s).replace(/,/g, "")); return isFinite(v) && v > -5 && v < 30 ? v : null; };
const put = (b, t, d, v) => { if (v == null) return; const s = (src[b][t] ||= []); const i = s.findIndex(([x]) => x === d); if (i >= 0) s[i][1] = v; else s.push([d, v]); };

// Korea Money Brokerage: table "전송일 | 1Y | 2Y | 3Y | 4Y | 5Y | 7Y | 10Y", one row per date (YYYY/MM/DD)
function parseKmb(html) {
  let hdr = null, n = 0;
  for (const c of rowsOf(html)) {
    if (c.some((x) => /^1Y$/i.test(x)) && c.some((x) => /^10Y$/i.test(x))) { hdr = c.map((x) => { const m = /^(\d+)Y$/i.exec(x); return m ? +m[1] : null; }); continue; }
    const dm = /^(\d{4})[\/.-](\d{2})[\/.-](\d{2})$/.exec(c[0] || "");
    if (!hdr || !dm) continue;
    const d = `${dm[1]}-${dm[2]}-${dm[3]}`;
    c.forEach((x, i) => { const t = hdr[i]; if (t && TEN.includes(t)) { put("kmb", t, d, num(x)); } });
    n++;
  }
  return n;
}
// Seoul Money Brokerage: "2026 년 10 월 30 일" heading, then rows "1Y | receive | mid | pay"
function parseSmbsDay(html) {
  const dates = [...html.matchAll(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  const d = dates.at(-1); if (!d) return 0;
  let n = 0;
  for (const c of rowsOf(html)) {
    const m = /^(\d+)Y$/i.exec(c[0] || ""); if (!m || c.length < 4) continue;
    const t = +m[1]; if (!TEN.includes(t)) continue;
    const mid = num(c[2]); if (mid == null) continue;
    put("smbs", t, d, mid); n++;
  }
  return n;
}

const log = [];
try {
  const h = await get("https://www.kmbco.com/kor/rate/deri_rate.do");
  if (PROBE) { fs.mkdirSync("data/korea-irs-probe", { recursive: true }); fs.writeFileSync("data/korea-irs-probe/kmb.html", h); }
  log.push(`KMB: ${parseKmb(h)} dates`);
} catch (e) { log.push(`KMB failed: ${e.message}`); }
try {
  const h = await get("http://www.smbs.biz/Exchange/IRS.jsp");
  if (PROBE) { fs.mkdirSync("data/korea-irs-probe", { recursive: true }); fs.writeFileSync("data/korea-irs-probe/smbs.html", h); }
  log.push(`SMBS: ${parseSmbsDay(h)} tenors`);
} catch (e) { log.push(`SMBS failed: ${e.message}`); }

// Combined series: Korea Money Brokerage closes for 1–10Y (it carries a run of dates), Seoul Money Brokerage mid
// where KMB has no close for that date or tenor (12Y, 15Y, 20Y and any day KMB missed).
const tenors = {};
for (const t of TEN) {
  const m = new Map(src.smbs[t] || []); for (const [d, v] of src.kmb[t] || []) m.set(d, v);
  const s = [...m].sort((a, b) => a[0].localeCompare(b[0]));
  for (const b of ["kmb", "smbs"]) if (src[b][t]) src[b][t].sort((a, b2) => a[0].localeCompare(b2[0]));
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
};
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(log.join("\n"), `\nLatest ${last}:`, TEN.map((t) => `${t}Y ${tenors[t]?.at(-1)?.[0] === last ? tenors[t].at(-1)[1] : "–"}`).join(" "));
