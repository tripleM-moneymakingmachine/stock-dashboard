// Malaysia tab, financial and SOE bonds (data/malaysia-credit.json): ringgit bonds and sukuk of Malaysian financial
// institutions (banks, Cagamas, insurers, finance companies) and state-owned / government-linked issuers (DanaInfra,
// Prasarana, PTPTN, LPPSA, Khazanah, Pengurusan Air, development banks, ...), from BIX Malaysia (the Bond+Sukuk
// Information Exchange, bixmalaysia.com), which publishes every issuer's active bonds with their latest trade.
//  - Issuers: BIX's issuer list, classified by name into "Financial" and "SOE" (rules below); everything else is left out.
//  - Each run reads every selected issuer's page (its most recently traded bonds: rating, last traded date, yield,
//    price and amount, amount outstanding) and keeps every bond it has ever seen, so the register grows run by run.
//  - New bonds get one read of their security page for stock code, ISIN, coupon, issue and maturity dates and
//    instrument (a few hundred per run until the register is complete).
//  - Each bond is compared with its reference curve from data/malaysia.json: Cagamas and Khazanah papers with FAST's
//    curves for them, rated bonds with FAST's curve for their rating, government-guaranteed and unrated SOE bonds with
//    the MGS curve; the spread to MGS is shown for every bond.
// Usage: node scripts/fetch-malaysia-credit.mjs. Anything that fails keeps the previous file.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";

const OUT = "data/malaysia-credit.json";
const BIX = "https://bixmalaysia.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const DETAIL_MAX = +(process.env.MY_CREDIT_DETAIL || 350);
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const r4 = (v) => v == null || !isFinite(v) ? null : +(+v).toFixed(4);
const r1 = (v) => v == null || !isFinite(v) ? null : +(+v).toFixed(1);

async function http(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(40000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { if (i === tries) throw e; await new Promise((s) => setTimeout(s, 1500 * i)); }
  }
}
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const num = (s) => { const v = parseFloat(String(s ?? "").replace(/[,\s]/g, "")); return isFinite(v) ? v : null; };
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const date = (s) => { s = String(s || "").trim(); let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/); if (m) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`; m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };

// ---------- classification by issuer name ----------
// SOE: federal statutory bodies, MOF Inc. / Khazanah / development-finance institutions and their funding vehicles
const SOE = [
  /DANAINFRA/i, /PRASARANA/i, /KHAZANAH/i, /PERBADANAN TABUNG PENDIDIKAN|PTPTN/i, /LEMBAGA PEMBIAYAAN PERUMAHAN|LPPSA/i,
  /PENGURUSAN AIR/i, /JAMBATAN KEDUA/i, /BANK PEMBANGUNAN/i, /SMALL MEDIUM ENTERPRISE DEVELOPMENT BANK|SME BANK/i,
  /BANK SIMPANAN NASIONAL/i, /BANK KERJASAMA RAKYAT/i, /EXPORT-IMPORT BANK OF MALAYSIA|EXIM BANK/i, /BANK PERTANIAN|AGROBANK/i,
  /MALAYSIA RAIL LINK/i, /MASS RAPID TRANSIT/i, /SYARIKAT PERUMAHAN NEGARA/i, /1MALAYSIA DEVELOPMENT/i, /TURUS PESAWAT/i,
  /GOVCO/i, /LEMBAGA/i, /PERBADANAN/i, /RETIREMENT FUND|KUMPULAN WANG PERSARAAN/i, /URUSHARTA JAMAAH/i, /DANAHARTA/i,
  /PETROLIAM NASIONAL|PETRONAS/i, /TENAGA NASIONAL/i, /PROJEK LEBUHRAYA USAHASAMA/i, /MALAYSIA AIRPORTS/i, /PELABURAN HARTANAH/i,
  /BANK NEGARA/i, /KERAJAAN|GOVERNMENT OF MALAYSIA/i, /MINISTER OF FINANCE|MOF INC/i, /MALAYSIA DEBT VENTURES/i, /DANAJAMIN/i,
];
const FIN = [
  /\bBANK\b/i, /BANKING/i, /CAGAMAS/i, /INSURANCE|ASSURANCE|TAKAFUL|REINSURANCE|RE-INSURANCE/i, /AEON CREDIT/i, /\bMBSB\b|MALAYSIA BUILDING SOCIETY/i,
  /AMMB|AMBANK|AMISLAMIC/i, /\bCIMB\b/i, /\bRHB\b/i, /\bAFFIN\b/i, /ALLIANCE (BANK|ISLAMIC|INVESTMENT)/i, /MUAMALAT/i, /KENANGA/i,
  /HONG LEONG (BANK|ISLAMIC|INVESTMENT|ASSURANCE|FINANCIAL)/i, /PUBLIC (BANK|ISLAMIC|INVESTMENT)/i, /MALAYAN BANKING|MAYBANK/i,
  /OCBC|UNITED OVERSEAS BANK|\bUOB\b|HSBC|STANDARD CHARTERED|BANK OF CHINA|INDUSTRIAL AND COMMERCIAL BANK|MIZUHO|MUFG|SUMITOMO MITSUI/i,
  /ETIQA|GREAT EASTERN|ALLIANZ|\bMCIS\b|MANULIFE|ZURICH|PRUDENTIAL|SYARIKAT TAKAFUL|AIA\b/i, /TOYOTA CAPITAL|BMW (LEASING|CREDIT)|MERCEDES-BENZ SERVICES/i,
  /DANAJAMIN/i, /CREDIT GUARANTEE/i, /SECURITIES BERHAD|INVESTMENT BANK/i, /FINANCE BERHAD|FINANCIAL (GROUP|HOLDINGS|SERVICES)/i,
];
const SOE_FIRST = [/BANK PEMBANGUNAN/i, /SME BANK|SMALL MEDIUM ENTERPRISE DEVELOPMENT BANK/i, /BANK SIMPANAN NASIONAL/i, /BANK KERJASAMA RAKYAT/i, /EXPORT-IMPORT BANK OF MALAYSIA|EXIM BANK/i, /AGROBANK|BANK PERTANIAN/i, /BANK NEGARA/i];
const NOT_SOE = [];
function classify(name) {
  if (SOE_FIRST.some((re) => re.test(name))) return "SOE";
  if (/CAGAMAS/i.test(name)) return "Financial";
  if (SOE.some((re) => re.test(name)) && !NOT_SOE.some((re) => re.test(name))) return "SOE";
  if (FIN.some((re) => re.test(name))) return "Financial";
  return null;
}

// ---------- 0. probe (diagnostics while the BIX API mapping is being settled) ----------
if (process.env.MY_CREDIT_PROBE !== "0") {
  for (const u of [`${BIX}/investor-tools/issuer-search`, `${BIX}/investor-tools/bix-search`]) {
    try {
      const h = await http(u);
      for (const m of h.matchAll(/searchCriteria|bixapi\/[A-Za-z]+\/[A-Za-z]+/g)) { const i = Math.max(0, m.index - 300); log(`PROBE ${u.split("/").pop()} @${m.index}: ${h.slice(i, i + 1500).replace(/\s+/g, " ")}`); }
      const sel = [...h.matchAll(/<select[^>]*id="([^"]+)"[\s\S]*?<\/select>/gi)].map((m) => `${m[1]}: ${strip(m[0]).slice(0, 300)}`); log(`PROBE selects ${u.split("/").pop()}: ${sel.join(" | ")}`);
    } catch (e) { log(`PROBE ${u} failed: ${e.message}`); }
  }
  const post = async (path, form) => { try { const r = await fetch(`${BIX}${path}`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(30000) }); log(`PROBE POST ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 900)}`); } catch (e) { log(`PROBE ${path} failed: ${e.message}`); } };
  await post("/bixapi/search/GetTradingActivities", { draw: "1", start: "0", length: "3", "searchCriteria[sbid]": "12499" });
  await post("/bixapi/search/GetSearchChartSukukBond", { draw: "1", start: "0", length: "5", "searchCriteria[sbid]": "12499", "searchCriteria[chkSukuk]": "3", "searchCriteria[category]": "", "searchCriteria[searchName]": "DANAINFRA" });
}

// ---------- 1. issuers ----------
let issuers = prev.issuers || [];
try {
  const h = await http(`${BIX}/investor-tools/issuer-search`);
  const found = new Map();
  for (const m of h.matchAll(/issuer-info-page\?issuerID=(\d+)[^>]*>([\s\S]*?)<\/a>/gi)) { const nm = strip(m[2]); if (nm && !found.has(m[1])) found.set(m[1], nm); }
  log(`BIX issuer list: ${found.size} issuers on the page (${h.length} bytes)`);
  if (found.size < 300) {
    const i = h.search(/issuer-info-page/i);
    log(`  page sample: ${h.slice(Math.max(0, i - 600), i + 400).replace(/\s+/g, " ")}`);
    for (const m of h.matchAll(/(bixapi[^"'\s<>]*|\/api\/[^"'\s<>]*)/gi)) log(`  api ref: ${m[1]}`);
  }
  if (found.size) {
    const sel = [...found].map(([id, name]) => ({ id: +id, name, cat: classify(name) })).filter((x) => x.cat);
    const keep = new Map(issuers.map((x) => [x.id, x])); for (const x of sel) keep.set(x.id, { ...keep.get(x.id), ...x });
    issuers = [...keep.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  log(`selected issuers: ${issuers.length} (Financial ${issuers.filter((x) => x.cat === "Financial").length}, SOE ${issuers.filter((x) => x.cat === "SOE").length})`);
} catch (e) { log(`BIX issuer list failed: ${e.message}; keeping ${issuers.length}`); }

// ---------- 2. each issuer's recently traded bonds ----------
const reg = new Map((prev.bonds || []).map((b) => [b.sbid, b]));
let pages = 0, rowsSeen = 0, firstDump = false;
await pool(issuers, 4, async (iss) => {
  try {
    const h = await http(`${BIX}/issuer-info-page?issuerID=${iss.id}`); pages++;
    if (!h) return;
    const short = (strip(h).match(/Issuer Short Name\s*:\s*([^:]+?)\s+Registration/i) || [])[1]?.trim(); if (short) iss.short = short;
    const trs = h.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    let n = 0;
    for (const tr of trs) {
      const sb = tr.match(/security-info-page\?SBID=(\d+)/i); if (!sb) continue;
      const c = (tr.match(/<td[\s\S]*?<\/td>/gi) || []).map(strip);
      if (c.length < 8) continue;
      const id = +sb[1], o = reg.get(id) || { sbid: id, first: prev.bonds ? new Date().toISOString().slice(0, 10) : null };
      const ld = date(c[3]);
      reg.set(id, { ...o, name: c[0], issuerId: iss.id, issuer: iss.name, issuerShort: iss.short || o.issuerShort || null, cat: iss.cat, rating: c[1] || null, category: c[2] || null, out: num(c[7]) ?? o.out ?? null,
        ...(ld && (!o.ld || ld >= o.ld) ? { ld, ly: num(c[4]), lpx: num(c[5]), lamt: num(c[6]), py: ld !== o.ld ? o.ly ?? null : o.py ?? null, pld: ld !== o.ld ? o.ld ?? null : o.pld ?? null } : {}) });
      n++;
    }
    rowsSeen += n;
    if (!n && !firstDump && /Active Bond/i.test(h)) { firstDump = true; const i = h.search(/ACTIVE BOND \+ SUKUK/i); log(`  no rows parsed for ${iss.name}; sample: ${h.slice(i, i + 900).replace(/\s+/g, " ")}`); }
  } catch (e) { log(`  issuer ${iss.id} ${iss.name} failed: ${e.message}`); }
});
log(`issuer pages: ${pages}, bond rows ${rowsSeen}, register ${reg.size}`);

// ---------- 3. security details for bonds not yet described ----------
const need = [...reg.values()].filter((b) => !b.isin && !b.noDetail).sort((a, b) => (b.ld || "").localeCompare(a.ld || "")).slice(0, DETAIL_MAX);
let got = 0;
await pool(need, 4, async (b) => {
  try {
    const h = await http(`${BIX}/security-info-page?SBid=${b.sbid}`); if (!h) { b.noDetail = true; return; }
    const t = strip(h);
    const f = (re) => (t.match(re) || [])[1]?.trim() || null;
    b.isin = f(/ISIN Code\s+(MY[A-Z0-9]{10})/i);
    b.code = f(/Stock Code\s+([A-Z0-9]{6,8})\b/i);
    b.instrument = f(/Instrument Code\s+([A-Z0-9-]+)/i);
    b.shariah = f(/Islamic Concept\s+([A-Z' -]+?)\s+Stock Code/i); if (b.shariah && /N\/A/i.test(b.shariah)) b.shariah = null;
    b.issue = date(f(/Issue Date\s+(\d{2}-\d{2}-\d{4})/i));
    b.mat = date(f(/Maturity Date\s+(\d{2}-\d{2}-\d{4})/i));
    b.coupon = num(f(/Coupon Rate\s+([\d.]+)/i));
    b.ctype = f(/Coupon Type\s+([A-Za-z -]+?)\s+Coupon Frequency/i);
    b.issued = num(f(/Amount Issued \(RM'mil\)\s+([\d,.]+)/i));
    if (b.isin || b.code) got++; else b.noDetail = true;
  } catch (e) { /* retried next run */ }
});
log(`security details: ${got} of ${need.length} read; ${[...reg.values()].filter((b) => !b.isin).length} still without ISIN`);

// ---------- 4. reference curves from data/malaysia.json ----------
let my = null; try { my = JSON.parse(readFileSync("data/malaysia.json", "utf8")); } catch {}
const lin = (pts) => (t) => { if (!pts?.length) return null; if (t <= pts[0][0]) return pts[0][1]; for (let i = 0; i < pts.length - 1; i++) if (t <= pts[i + 1][0]) { const [a, y0] = pts[i], [b, y1] = pts[i + 1]; return y0 + (y1 - y0) * (t - a) / (b - a); } return pts.at(-1)[1]; };
const C = Object.fromEntries(Object.entries(my?.pb || {}).map(([k, p]) => [k, lin(p.curve?.pts)]));
const mgs = lin(my?.curve?.pts);
const RATING = [[/^AAA/, "aaa"], [/^AA1|^AA\+/, "aa1"], [/^AA2|^AA\b(?![-+123])/, "aa"], [/^AA3|^AA-/, "aa3"], [/^A1|^A\+/, "a1"], [/^A2|^A\b(?![-+123])/, "a"], [/^A3|^A-/, "a3"], [/^BBB/, "bbb"]];
const refOf = (b) => {
  if (/CAGAMAS/i.test(b.issuer) && C.cagamas) return ["cagamas", "Cagamas (FAST)"];
  if (/KHAZANAH/i.test(b.issuer) && C.khazanah) return ["khazanah", "Khazanah (FAST)"];
  const r = String(b.rating || "").toUpperCase().replace(/\s*\(.*?\)\s*/g, "").replace(/_?IS$/, "").trim();
  for (const [re, k] of RATING) if (re.test(r) && C[k]) return [k, `${my.pb[k].short} corporate (FAST)`];
  return [null, "MGS"];
};
const day = my?.tradeDay || new Date().toISOString().slice(0, 10);
const bonds = [...reg.values()].filter((b) => !b.mat || b.mat > day).map((b) => {
  const ttm = b.mat ? (Date.parse(b.mat) - Date.parse(day)) / (365.25 * 864e5) : null;
  const [rk, rl] = refOf(b), t = ttm != null ? Math.max(ttm, 0.5) : null;
  const ref = t == null ? null : rk ? C[rk](t) : mgs ? mgs(Math.max(t, 1)) : null, m = t != null && mgs ? mgs(Math.max(t, 1)) : null;
  const fresh = b.ld && (Date.parse(day) - Date.parse(b.ld)) / 864e5 <= 30;
  return { ...b, ttm: r4(ttm), ref: rl, curve: r4(ref), vs: fresh && b.ly != null && ref != null && ttm >= 0.5 ? r1((b.ly - ref) * 100) : null, vsMgs: fresh && b.ly != null && m != null && ttm >= 0.5 ? r1((b.ly - m) * 100) : null };
}).sort((a, b) => (a.ttm ?? 99) - (b.ttm ?? 99));

const out = {
  updated: Math.floor(Date.now() / 1000), curveDay: day,
  src: "BIX Malaysia (Bond+Sukuk Information Exchange): issuers' active bonds and sukuk with their latest trade, and security details (stock code, ISIN, coupon, dates); reference curves from Bank Negara Malaysia's FAST consolidated indicative yields",
  issuers, bonds,
  counts: { issuers: issuers.length, bonds: bonds.length, financial: bonds.filter((b) => b.cat === "Financial").length, soe: bonds.filter((b) => b.cat === "SOE").length, withIsin: bonds.filter((b) => b.isin).length, tradedOn: bonds.filter((b) => b.ld === day).length },
};
if (!bonds.length && prev.bonds?.length) { log("No bonds this run; keeping the previous file."); process.exit(0); }
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}: ${JSON.stringify(out.counts)}`);
summary(`Malaysia credit: ${out.counts.bonds} financial / SOE bonds (${out.counts.tradedOn} traded on ${day})`);
