// Policy bank bond master list for the China tab: China Development Bank (国开), Agricultural Development Bank
// of China (农发) and Export-Import Bank of China (进出口) bonds, keyed by bond code, with ISIN, issue date,
// maturity and coupon from CFETS bond information (chinamoney.com.cn).
// Which bonds: every policy financial bond (政策性金融债, CFETS bond type 100003) on the CFETS bond-info list, the
// same register of interbank bonds held in custody at ChinaBond (CCDC), sorted to an issuer by name; plus anything
// seen trading in data/china.json. The list is read newest issue first, so new issues are picked up on the next
// daily run; after the first full read, a run stops once three whole pages are already known (--full re-reads all).
// Each bond's English detail gives maturity, coupon and ISIN once. A failed lookup is retried on later runs (up to
// 5 tries). Bank capital bonds (二级资本债, 永续债) are left out, as they price off other curves.
// Writes data/pb-master.json. Usage: node scripts/fetch-pb-master.mjs [--full]
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: "https://www.chinamoney.com.cn/", Origin: "https://www.chinamoney.com.cn", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" };
const BASE = "https://www.chinamoney.com.cn/ags/ms/cm-u-bond-md/";
const T0 = Date.now(), BUDGET = 20 * 60 * 1000; // stop and save after 20 minutes; the next run continues
const FULL = process.argv.includes("--full");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const blank = (v) => v == null || v === "" || v === "---" ? null : v;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

async function post(path, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { method: "POST", headers: H, body, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1500 * (i + 1)); }
  }
}

let master = { bonds: {} };
try { master = JSON.parse(readFileSync("data/pb-master.json", "utf8")); } catch {}
const B = master.bonds || (master.bonds = {});
let china = {};
try { china = JSON.parse(readFileSync("data/china.json", "utf8")); } catch { log("no data/china.json yet"); }

// codes to know about: today's traded policy bank bonds plus each issuer's register
for (const [k, p] of Object.entries(china.pb || {})) {
  for (const b of [...(p.bonds || []), ...(p.reg || [])]) {
    if (!b?.code) continue;
    const m = B[b.code] || (B[b.code] = { code: b.code });
    m.issuer = k;
    if (b.name && !m.name) m.name = b.name;
    if (b.isin && !m.isin) m.isin = b.isin;
  }
}

// Full CFETS list of policy financial bonds (English for code / ISIN / id, Chinese for the short name)
const ISSUERS = [["cdb", /国开|国家开发银行|China Development Bank/i], ["adbc", /农发|农业发展银行|Agricultural Development Bank/i], ["exim", /进出|进出口银行|Export-Import Bank/i]];
const CAPITAL = /二级资本|资本债|资本补充|永续|Tier 2|Perpetual|Capital/i;
const issuerOf = (...names) => { const s = names.filter(Boolean).join(" "); const hit = ISSUERS.find(([, re]) => re.test(s)); return hit ? hit[0] : null; };
const listPage = (path, n) => post(path, `pageNo=${n}&pageSize=15&bondName=&bondCode=&issueEnty=&bondType=100003&bondSpclPrjctVrty=&couponType=&issueYear=&entyDefinedCode=&rtngShrt=`);
const firstFull = !master.listDone;
let listNew = [], pages = 0, total = null, known = 0, listOk = false;
for (let n = 1; ; n++) {
  if (Date.now() - T0 > BUDGET / 2) { log("time budget reached during the list; the next run continues"); break; }
  let en, cn;
  try { [en, cn] = await Promise.all([listPage("BondMarketInfoListEN", n), listPage("BondMarketInfoList2", n)]); }
  catch (e) { log(`list page ${n} failed: ${e.message}`); break; }
  const rows = en?.data?.resultList || [];
  if (en?.data?.total) total = en.data.total;
  if (!rows.length) { listOk = true; break; }
  pages++;
  const names = {};
  for (const r of cn?.data?.resultList || []) names[r.bondDefinedCode] = r.bondName;
  let fresh = 0;
  for (const r of rows) {
    const code = r.bondCode; if (!code) continue;
    const cnName = names[r.bondDefinedCode];
    const enText = Object.values(r).filter((v) => typeof v === "string").join(" ");
    if (CAPITAL.test(`${cnName || ""} ${enText}`)) continue;
    const k = issuerOf(cnName, enText); if (!k) continue;
    const b = B[code] || (B[code] = { code });
    if (!b.def) { fresh++; listNew.push(code); }
    b.issuer = k; b.def = r.bondDefinedCode; b.listed = true;
    if (blank(r.isin)) b.isin = r.isin;
    if (cnName) b.name = cnName;
    if (!b.issue && blank(r.issueStartDate)) b.issue = r.issueStartDate;
  }
  known = fresh ? 0 : known + 1;
  if (!FULL && !firstFull && known >= 3) { listOk = true; break; }
  await sleep(150);
}
if (listOk && firstFull) master.listDone = true;
log(`CFETS policy bank list: ${pages} pages read (CFETS total ${total}), ${listNew.length} bonds new to the file${firstFull ? " (first full read)" : ""}`);
// a bond issued 31+ years ago has matured (policy bank bonds run at most 30 years): skip its detail call
const oldCut = `${+today.slice(0, 4) - 31}${today.slice(4)}`;
for (const b of Object.values(B)) if (!b.mat && b.issue && b.issue < oldCut) b.matured = true;

// v2: lookups before this needed CFETS's bond type (政策性金融债 = 100003); give those bonds their tries back
if (master.v !== 2) { for (const b of Object.values(B)) { delete b.tries; delete b.err; } delete master.probe; master.v = 2; }

const need = Object.values(B).filter((b) => !b.matured && !b.mat && (b.tries || 0) < 5)
  .sort((a, b) => (b.issue || "9").localeCompare(a.issue || "9")); // newest first, so new issues are read first
log(`policy bank master: ${Object.keys(B).length} bonds on file, ${need.length} to look up`);
let done = 0, fail = 0;
async function lookup(b) {
  try {
    if (!b.def) {
      const j = await post("BondMarketInfoListEN", `pageNo=1&pageSize=15&bondName=&bondCode=${encodeURIComponent(b.code)}&issueEnty=&bondType=100003&bondSpclPrjctVrty=&couponType=&issueYear=&entyDefinedCode=&rtngShrt=`);
      const r = (j?.data?.resultList || []).find((x) => x.bondCode === b.code);
      if (!r) throw new Error("not in the CFETS list");
      b.def = r.bondDefinedCode;
      if (blank(r.isin)) b.isin = r.isin;
      if (!b.issue && blank(r.issueStartDate)) b.issue = r.issueStartDate;
    }
    const j = await post("BondDetailInfoEN", `bondDefinedCode=${b.def}`);
    const d = j?.data?.bondBaseInfo; if (!d) throw new Error("no bondBaseInfo");
    if (blank(d.isinCode)) b.isin = d.isinCode;
    if (blank(d.mrtyDate)) b.mat = d.mrtyDate;
    if (blank(d.issueDate)) b.issue = d.issueDate;
    if (blank(d.bondPeriod)) b.term = d.bondPeriod.replace(/Year/i, "Y").replace(/Month/i, "M").replace(/Day/i, "D");
    const cp = parseFloat(blank(d.parCouponRate) ?? "");
    if (isFinite(cp)) b.coupon = cp;
    if (!b.mat) throw new Error("no maturity in detail");
    delete b.tries; delete b.err; done++;
  } catch (e) { b.tries = (b.tries || 0) + 1; b.err = String(e.message).slice(0, 80); fail++; if (fail <= 5) log(`lookup ${b.code} failed: ${e.message}`); }
}
for (let i = 0; i < need.length; i += 4) {
  if (Date.now() - T0 > BUDGET) { log("time budget reached; the next run continues"); break; }
  await Promise.all(need.slice(i, i + 4).map(lookup));
  await sleep(250);
}
for (const b of Object.values(B)) b.matured = b.mat ? b.mat < today : !!(b.issue && b.issue < oldCut);

const live = Object.values(B).filter((b) => !b.matured);
master.updated = Math.floor(Date.now() / 1000);
master.src = "CFETS (chinamoney.com.cn) bond information: full list of policy financial bonds (政策性金融债) in English and Chinese, and English detail for ISIN, maturity and coupon";
mkdirSync("data", { recursive: true });
writeFileSync("data/pb-master.json", JSON.stringify(master));
const by = (k) => live.filter((b) => b.issuer === k);
const newIss = live.filter((b) => b.issue && (Date.parse(today) - Date.parse(b.issue)) / 864e5 <= 30);
const msg = `Policy bank master: ${live.length} outstanding (CDB ${by("cdb").length}, ADBC ${by("adbc").length}, EXIM ${by("exim").length}), ${live.filter((b) => b.mat).length} with maturity; looked up ${done}, failed ${fail}; ${newIss.length} issued in the last 30 days${newIss.length ? `: ${newIss.slice(0, 12).map((b) => b.name || b.code).join(", ")}` : ""}`;
log(msg); summary(`- ${msg}`);
