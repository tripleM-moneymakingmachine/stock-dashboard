// China tab data: the ChinaBond (CCDC) China government bond yield curve, standard-tenor history, and every
// outstanding CGB by bond code and ISIN with its CCDC curve yield and today's CFETS interbank traded yield.
//  - CCDC curve: yield.chinabond.com.cn searchYc, 中债国债收益率曲线 (到期 / yield to maturity), latest published day.
//  - CCDC history: queryYz, one year of daily closes for the standard tenors.
//  - Bonds: data/cgb-master.json (built by fetch-cgb-master.mjs from CFETS bond info) plus the CFETS cash-bond
//    trade feed (CbtPri), which gives the latest and weighted-average traded yield of each bond traded today.
// The curve yield shown for each bond is the CCDC curve read at that bond's remaining term (linear between
// CCDC's curve points); "vs curve" is the CFETS traded yield minus that, in basis points.
//  - Policy bank curves: CCDC's 中债政策性金融债收益率曲线 for China Development Bank (国开), Agricultural Development
//    Bank (农发) and Export-Import Bank (进出口), read the same way (latest curve + one year of standard tenors), with
//    each issuer's bonds traded today on CFETS and their spread to that issuer's curve. Written under `pb`.
// Anything that fails keeps the previous file's values. Writes data/china.json. Usage: node scripts/fetch-china.mjs
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const CCDC = { "User-Agent": UA, Accept: "application/json, text/javascript, */*", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: "https://yield.chinabond.com.cn/cbweb-mn/yield_main?locale=zh_CN", Origin: "https://yield.chinabond.com.cn", "X-Requested-With": "XMLHttpRequest" };
const CFETS = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: "https://www.chinamoney.com.cn/", Origin: "https://www.chinamoney.com.cn", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" };
const CGB = "2c9081e50a2f9606010a3068cae70001"; // 中债国债收益率曲线
const TENORS = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50];
const shDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const today = shDate(Date.now());
const dayOf = (t) => (t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : today); // label trades by the CFETS deal date, not the run date (weekend runs return Friday's deals)
const addDays = (d, n) => shDate(Date.parse(d + "T12:00:00+08:00") + n * 864e5);
// CCDC policy bank bond curves (yield to maturity). `re` matches the issuer in a CFETS bond name.
const PB = [
  { k: "cdb", id: "8a8b2ca037a7ca910137bfaa94fa5057", short: "CDB", name: "China Development Bank", cn: "中债国开债收益率曲线", re: /国开|国家开发银行/ },
  { k: "adbc", id: "2c9081e50a2f9606010a306abdde0003", short: "ADBC", name: "Agricultural Development Bank of China", cn: "中债农发行债收益率曲线", re: /农发|农业发展银行/ },
  { k: "exim", id: "8a8b2ca0567e033b01567ea9c1d96af8", short: "EXIM", name: "Export-Import Bank of China", cn: "中债进出口行债收益率曲线", re: /进出|进出口银行/ },
];
const CAPITAL = /二级资本|资本债|资本补充|永续/;
// Negotiable certificates of deposit (同业存单): there are tens of thousands outstanding, so the table lists the
// ones traded on CFETS today, each against CCDC's commercial bank NCD curve for AAA issuers.
const NCD = { id: "8308218D1D030E0DE0540010E03EE6DA", cn: "中债商业银行同业存单收益率曲线(AAA)", re: /同业存单|\dCD\d|CD\d{3}/ };
// Credit bonds traded on CFETS today, in two groups next to NCDs:
//  - SOE: central state-owned enterprises (央企) — MTN, SCP, CP and PPN (custodied at SHCH, 上清所) and enterprise /
//    agency bonds (custodied at CCDC, 中债登), each against CCDC's AAA CP & note or AAA corporate bond curve.
//  - Financial: bank senior, Tier-2, perpetual and TLAC bonds, policy bank capital bonds, securities, insurance,
//    leasing and AMC bonds (CCDC custody, except CP/MTN-type paper at SHCH), against CCDC's commercial bank curves.
// Curve ids are looked up by name in CCDC's curve tree (queryTree) each run; the ids below are fallbacks.
const CR = [
  { k: "note", id: "2c9081880fa9d507010fb8505b393fe7", cn: "中债中短期票据收益率曲线(AAA)" },
  { k: "corp", id: "2c9081e50a2f9606010a309f4af50111", cn: "中债企业债收益率曲线(AAA)" },
  { k: "bank", id: "2c9081e9259b766a0125be8b5115149f", cn: "中债商业银行普通债收益率曲线(AAA)" },
  { k: "t2", id: "8a8b2cee67a9cd3a0167ac48fc234850", cn: "中债商业银行二级资本债收益率曲线(AAA-)" },
  { k: "perp", id: null, cn: "中债商业银行无固定期限资本债券收益率曲线(AA+)" },
  { k: "sec", id: "8c2f642dc17d4e20997d572cbef24e07", cn: "中债证券公司债收益率曲线" },
];
const FIN_RE = /二级|银行|农商|农信|村镇|金融债|证券|保险|人寿|财险|租赁|消费金融|汽车金融|资产管理|信达|华融|长城资产|东方资产|二级资本|永续|TLAC|资本补充/;
const SOE_RE = /国家电网|国网|南方电网|南网|中国石油|中石油|中国石化|中石化|中海油|中国海油|海洋石油|国家管网|中国移动|中国电信|中国联通|中国铁塔|国家能源|国能|国家电投|国电投|电投|华能|大唐|华电|三峡|长江电力|中广核|中核|核工业|中国铁路|国铁|铁道|中国中铁|中铁|中国铁建|中铁建|中国建筑|中建|中交|中国交建|交通建设|电建|能建|中国化工|中化|中粮|中储粮|招商局|招商蛇口|保利|华润|宝武|宝钢|鞍钢|首钢|中铝|中国铝业|五矿|中冶|诚通|国新|中信集团|中国中信|航空工业|中航|航天|兵器|兵装|中国船舶|中船|中远|中国远洋|东风|一汽|中国建材|中国电子|中国通用|国投集团|国投电力|国投资本|国投泰康|国投租赁|国家开发投资|中国节能|中国旅游|中国医药|国药|中国黄金|中国盐业|中国林业|中煤|中国煤炭|中国中车|中车|中国电科|中国电力|中国能源建设|中国安能|中国稀土|中国物流|中国国新|中国诚通/;
const soeType = (n) => /超短期|SCP/.test(n) ? "SCP" : /定向|PPN/.test(n) ? "PPN" : /短期融资|\dCP\d/.test(n) ? "CP" : /中期票据|MTN/.test(n) ? "MTN" : /铁道|政府支持/.test(n) ? "Agency" : /企业债|企债/.test(n) ? "Enterprise" : /公司债/.test(n) ? "Corporate" : "MTN";
const finType = (n) => /TLAC/.test(n) ? "TLAC" : /保险|人寿|财险/.test(n) ? "Insurance" : /二级|资本补充/.test(n) ? "Tier-2" : /永续|无固定/.test(n) ? "Perpetual" : /证券|券商/.test(n) ? "Securities" : /保险|人寿|财险/.test(n) ? "Insurance" : /租赁|消费金融|汽车金融|资产管理|信达|华融|长城资产|东方资产/.test(n) ? "Other fin." : "Senior";
const SHCH_T = new Set(["MTN", "SCP", "CP", "PPN"]);
const depOf = (t, n) => (SHCH_T.has(t) || /SCP|MTN|CP\d|PPN|超短期|短期融资|中期票据/.test(n) ? "SHCH" : "CCDC");
const curveKey = (grp, t) => grp === "soe" ? (/Agency|Enterprise|Corporate/.test(t) ? "corp" : "note") : t === "Tier-2" ? "t2" : t === "Perpetual" ? "perp" : t === "Securities" ? "sec" : t === "Insurance" ? null : "bank";
const issuerOf = (n = "") => n.replace(/^\d{2}/, "").replace(/(MTN|SCP|CP|PPN|GN|TLAC|二级|资本补充|永续|绿色|科创|小微|三农|债|\d).*$/, "").trim() || null;
async function post(url, headers, body = "", ms = 30000) {
  const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split("?")[0]}`);
  return r.json();
}

let prev = {};
try { prev = JSON.parse(readFileSync("data/china.json", "utf8")); } catch {}
let master = { bonds: {} };
try { master = JSON.parse(readFileSync("data/cgb-master.json", "utf8")); } catch { log("no data/cgb-master.json yet"); }

// CCDC curve on one day (null when that day has no curve yet)
async function curveOn(id, d, ms, minPts = 11) {
  const j = await post(`https://yield.chinabond.com.cn/cbweb-mn/yc/searchYc?xyzSelect=txy&&workTimes=${d}&&dxbj=0&&qxll=0,&&yqqxN=N&&yqqxK=K&&ycDefIds=${id},&&wrjxCBFlag=0&&locale=zh_CN`, CCDC, "", ms);
  const s = (Array.isArray(j) ? j : []).find((x) => x?.seriesData?.length >= minPts);
  return s ? { date: s.worktime || d, pts: s.seriesData.map(([t, y]) => [+(+t).toFixed(4), +(+y).toFixed(4)]).filter(([t, y]) => isFinite(t) && isFinite(y)) } : null;
}
const interp = (pts, x) => {
  if (!pts?.length || !isFinite(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts.at(-1)[1];
};
// CCDC standard-tenor history, one year. CCDC returns nothing when asked for more than ~7 tenors at once,
// so ask in batches; skip entirely when the previous file already runs to the latest curve day.
async function history(id, curve, prevTen, tens, tag, ms) {
  let out = {};
  const fresh = curve && tens.every((t) => (prevTen?.[t]?.length || 0) > 150 && prevTen[t].at(-1)[0] >= curve.date);
  if (fresh) { out = { ...prevTen }; log(`${tag} history: previous file is current`); }
  else for (let i = 0; i < tens.length; i += 5) {
    const part = tens.slice(i, i + 5);
    try {
      const dcq = part.map((t) => `${t},${t}y;`).join("");
      const j = await post(`https://yield.chinabond.com.cn/cbweb-mn/yc/queryYz?bjlx=no&&dcq=${dcq}&&startTime=${addDays(today, -370)}&&endTime=${today}&&qxlx=0,&&yqqxN=N&&yqqxK=K&&par=day&&ycDefIds=${id},&&locale=zh_CN`, CCDC, "", ms);
      for (const s of Array.isArray(j) ? j : []) {
        const t = parseFloat(String(s.ycDefId || "").slice(id.length));
        if (!isFinite(t) || !s.seriesData?.length) continue;
        out[t] = s.seriesData.map(([ms, y]) => [shDate(ms), +(+y).toFixed(4)]).filter(([, y]) => isFinite(y)).sort((a, b) => a[0] < b[0] ? -1 : 1);
      }
    } catch (e) { log(`${tag} history ${part.join(",")} failed: ${e.message}`); }
  }
  for (const t of tens) if (!out[t]?.length && prevTen?.[t]) out[t] = prevTen[t];
  // make sure each tenor's last point is the latest curve day
  if (curve) for (const t of tens) {
    const h = out[t] || (out[t] = []), y = interp(curve.pts, t);
    if (y == null) continue;
    if (!h.length || h.at(-1)[0] < curve.date) h.push([curve.date, +y.toFixed(4)]);
  }
  for (const t of Object.keys(out)) if (!out[t]?.length) delete out[t];
  log(`${tag} tenors:`, tens.map((t) => `${t}Y ${out[t]?.at(-1)?.[1] ?? "–"}`).join(" · "));
  return out;
}

// 1. Latest CCDC CGB curve (walk back over holidays / before today's curve is published)
let curve = null;
for (let i = 0; i < 10 && !curve; i++) {
  const d = addDays(today, -i);
  try { curve = await curveOn(CGB, d); } catch (e) { log(`curve ${d} failed: ${e.message}`); }
}
if (!curve) { curve = prev.curve || null; log("curve: kept previous"); } else log(`curve: ${curve.date}, ${curve.pts.length} points`);

// 2. CGB standard-tenor history
const tenors = await history(CGB, curve, prev.tenors, TENORS, "CGB", 30000);

// 2b. Policy bank curves. CCDC publishes them alongside the CGB curve, so ask for the CGB curve's day (then a
// couple of days back); reuse the previous file when it already has that day. Capped at ~2 minutes in all so a
// slow CCDC cannot hold up the deploy.
const pb = {}, pbStart = Date.now(), pbLeft = () => 120000 - (Date.now() - pbStart);
for (const p of PB) {
  const was = prev.pb?.[p.k] || {};
  let c = curve && was.curve?.date === curve.date ? was.curve : null;
  for (let i = 0; i < 3 && !c && curve && pbLeft() > 0; i++) {
    const d = addDays(curve.date, -i);
    try { c = await curveOn(p.id, d, 20000); } catch (e) { log(`${p.short} curve ${d} failed: ${e.message}`); }
  }
  if (!c) { c = was.curve || null; log(`${p.short} curve: ${c ? "kept previous" : "none"}`); } else log(`${p.short} curve: ${c.date}, ${c.pts.length} points, to ${c.pts.at(-1)?.[0]}Y`);
  const tens = c ? TENORS.filter((t) => t <= c.pts.at(-1)[0] + 1e-9) : [];
  const ten = c && pbLeft() > 0 ? await history(p.id, c, was.tenors, tens, p.short, 20000) : (was.tenors || {});
  pb[p.k] = { short: p.short, name: p.name, cn: p.cn, curve: c, tenors: ten, bonds: [] };
}

// 2b. CCDC AAA NCD curve (tenors out to the curve's end, typically 1Y)
const ncdWas = prev.ncd || {};
// its own time budget (the policy bank curves can use up theirs); the NCD curve only runs to 1Y, so it can have
// fewer points than the long curves; CCDC ids are tried as listed and in lower case
let ncdCurve = ncdWas.curve?.date === today && ncdWas.curve.pts?.length ? ncdWas.curve : null;
const ncdStart = Date.now(), ncdLeft = () => 60000 - (Date.now() - ncdStart);
// newest day first, from today (CCDC can publish the NCD curve before the CGB curve this file last read)
for (let i = 0; i < 5 && !ncdCurve && curve && ncdLeft() > 0; i++) {
  const d = addDays(today, -i);
  for (const id of [NCD.id, NCD.id.toLowerCase()]) {
    if (ncdCurve) break;
    try { ncdCurve = await curveOn(id, d, 20000, 3); if (ncdCurve) NCD.useId = id; } catch (e) { log(`NCD curve ${d} failed: ${e.message}`); }
  }
}
if (!ncdCurve) { ncdCurve = ncdWas.curve || null; log(`NCD curve: ${ncdCurve ? "kept previous" : "none"}`); } else log(`NCD curve: ${ncdCurve.date}, ${ncdCurve.pts.length} points, to ${ncdCurve.pts.at(-1)?.[0]}Y`);
const ncdTens = ncdCurve ? TENORS.filter((t) => t <= ncdCurve.pts.at(-1)[0] + 1e-9) : [];
const ncdTenors = ncdCurve && ncdLeft() > 0 ? await history(NCD.useId || NCD.id, ncdCurve, ncdWas.tenors, ncdTens, "NCD", 20000) : (ncdWas.tenors || {});

// 3. CFETS cash-bond trades today: CGBs, plus policy bank bonds sorted by issuer
let trades = {}, tradeTime = null, pbTrades = {}, pbTradeTime = null, ncdTrades = {}, ncdTradeTime = null, crTrades = {}, crTradeTime = null;
try {
  const j = await post("https://www.chinamoney.com.cn/ags/ms/cm-u-md-bond/CbtPri?flag=1&lang=cn&abdAssetEncdShrtDesc=&emaEntyEncdShrtDesc=", CFETS);
  const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : null; };
  for (const r of j?.records || []) {
    const name = r.abdAssetEncdFullDescByRmb || r.abdAssetEncdShrtDesc || "";
    const rec = { name, isin: r.isinCode && r.isinCode !== "---" ? r.isinCode : null, last: num(r.dmiLatestContraRate), wavg: num(r.dmiWghtdContraRate), px: num(r.dmiLatestRate), chg: num(r.bpNum), ttm: r.termToMaturity, t: r.showDate };
    if (master.bonds?.[r.bondcode] || /国债/.test(name)) {
      trades[r.bondcode] = rec;
      if (r.showDate && (!tradeTime || r.showDate > tradeTime)) tradeTime = r.showDate;
      continue;
    }
    const nm = `${r.abdAssetEncdShrtDesc || ""} ${r.abdAssetEncdFullDescByRmb || ""}`;
    if (NCD.re.test(nm)) {
      if (rec.last == null) continue;
      ncdTrades[r.bondcode] = { ...rec, short: r.abdAssetEncdShrtDesc || name };
      if (r.showDate && (!ncdTradeTime || r.showDate > ncdTradeTime)) ncdTradeTime = r.showDate;
      continue;
    }
    const p = PB.find((x) => x.re.test(nm));
    // credit: financial bonds (incl. a policy bank's own capital bonds, 二级资本债 / 永续债) and central SOE bonds
    if (rec.last != null && (!p || CAPITAL.test(nm)) && (FIN_RE.test(nm) || SOE_RE.test(nm))) {
      const grp = FIN_RE.test(nm) ? "fin" : "soe";
      crTrades[r.bondcode] = { ...rec, short: r.abdAssetEncdShrtDesc || name, grp, nm };
      if (r.showDate && (!crTradeTime || r.showDate > crTradeTime)) crTradeTime = r.showDate;
      continue;
    }
    // policy financial bonds only: a policy bank's own capital bonds (二级资本债, 永续债) price off other curves
    if (!p || rec.last == null || CAPITAL.test(nm)) continue;
    pbTrades[r.bondcode] = { ...rec, short: r.abdAssetEncdShrtDesc || name, issuer: p.k };
    if (r.showDate && (!pbTradeTime || r.showDate > pbTradeTime)) pbTradeTime = r.showDate;
  }
  log(`CFETS trades: ${Object.keys(trades).length} CGBs, ${Object.keys(ncdTrades).length} NCDs, ${Object.values(crTrades).filter((b) => b.grp === "soe").length} SOE and ${Object.values(crTrades).filter((b) => b.grp === "fin").length} financial bonds; policy banks ${PB.map((p) => `${p.short} ${Object.values(pbTrades).filter((b) => b.issuer === p.k).length}`).join(", ")}`);
} catch (e) { log(`trades failed: ${e.message}`); }
if (!Object.keys(trades).length && prev.tradeDay === today) { // keep this session's earlier read
  for (const b of prev.bonds || []) if (b.last != null) trades[b.code] = { name: b.name, isin: b.isin, last: b.last, wavg: b.wavg, px: b.px, chg: b.chg, t: prev.tradeTime };
  tradeTime = prev.tradeTime;
}
const pbFresh = Object.keys(pbTrades).length > 0;
// Exact maturity, coupon and ISIN from data/pb-master.json (fetch-pb-master.mjs, CFETS bond info). A bond not
// looked up yet gets a maturity estimated from CFETS's remaining term (quoted to 0.01 year), marked est.
let pbm = {};
try { pbm = JSON.parse(readFileSync("data/pb-master.json", "utf8")).bonds || {}; } catch { log("no data/pb-master.json yet"); }
const yrs = (mat) => (Date.parse(mat) - Date.parse(today)) / (365.25 * 864e5);
for (const p of PB) {
  const c = pb[p.k].curve?.pts;
  if (pbFresh) {
    pb[p.k].bonds = Object.entries(pbTrades).filter(([, b]) => b.issuer === p.k).map(([code, b]) => {
      const m = String(b.ttm || "").match(/([\d.]+)\s*([YD])/i), quoted = m ? (m[2].toUpperCase() === "D" ? +m[1] / 365 : +m[1]) : null;
      const mm = pbm[code], base = String(b.t || today).slice(0, 10);
      const mat = mm?.mat || (quoted > 0 ? shDate(Date.parse(base + "T12:00:00+08:00") + quoted * 365.25 * 864e5) : null);
      const ttm = mm?.mat ? yrs(mm.mat) : quoted;
      if (ttm == null || !(ttm > 0)) return null;
      const cy = c ? interp(c, ttm) : null;
      return { code, isin: mm?.isin || b.isin, name: b.short, full: b.name, coupon: mm?.coupon ?? null, issue: mm?.issue || null, mat, est: !mm?.mat || undefined, ttm: +ttm.toFixed(3), last: b.last, wavg: b.wavg, chg: b.chg, curve: cy == null ? null : +cy.toFixed(4), vs: cy == null ? null : +((b.last - cy) * 100).toFixed(1) };
    }).filter(Boolean).sort((a, b) => a.ttm - b.ttm);
  } else if (prev.pbTradeDay === today) // keep this session's earlier read
    pb[p.k].bonds = (prev.pb?.[p.k]?.bonds || []).filter((b) => !CAPITAL.test(b.name || "")).map((b) => b.mat ? b : { ...b, mat: shDate(Date.parse(today + "T12:00:00+08:00") + b.ttm * 365.25 * 864e5), est: true });
  // Register: every outstanding bond of this issuer (carried from the previous file, the full CFETS list in the
  // master and today's trades), for the futures tab's cash comparison. Exact maturities win over estimates.
  const reg = new Map();
  const put = (b) => {
    if (!b?.code || !b.mat || b.mat <= today || CAPITAL.test(b.name || "")) return;
    const old = reg.get(b.code);
    if (old && !old.est && b.est) return;
    reg.set(b.code, { code: b.code, name: b.name || old?.name || null, isin: b.isin || old?.isin || null, coupon: b.coupon ?? old?.coupon ?? null, issue: b.issue || old?.issue || null, mat: b.mat, ...(b.est ? { est: true } : {}) });
  };
  (prev.pb?.[p.k]?.reg || []).forEach(put);
  pb[p.k].bonds.forEach(put);
  Object.values(pbm).filter((b) => b.issuer === p.k && b.mat).forEach((b) => put({ ...b, name: b.name || reg.get(b.code)?.name }));
  // each register bond also carries this issuer's CCDC curve yield at its remaining term, for the bond table
  pb[p.k].reg = [...reg.values()].map((b) => { const ttm = yrs(b.mat), cy = c ? interp(c, ttm) : null; return { ...b, ttm: +ttm.toFixed(3), curve: cy == null ? null : +cy.toFixed(4) }; }).sort((a, b) => a.ttm - b.ttm);
}

// NCDs traded today, with maturity from CFETS's remaining term and the spread to the AAA NCD curve. Before the
// first trades of a session, the previous session's list is kept (its trade day is shown on the page).
const ncdFresh = Object.keys(ncdTrades).length > 0;
const issuerOfNcd = (n = "") => n.replace(/^\d{2}/, "").replace(/(CD|同业存单).*$/, "").trim() || null;
const ncdBonds = ncdFresh ? Object.entries(ncdTrades).map(([code, b]) => {
  const m = String(b.ttm || "").match(/([\d.]+)\s*([YD])/i), ttm = m ? (m[2].toUpperCase() === "D" ? +m[1] / 365 : +m[1]) : null;
  if (!(ttm > 0)) return null;
  const base = String(b.t || today).slice(0, 10);
  const cy = ncdCurve ? interp(ncdCurve.pts, ttm) : null;
  return { code, isin: b.isin, name: b.short, bank: issuerOfNcd(b.short), mat: shDate(Date.parse(base + "T12:00:00+08:00") + ttm * 365.25 * 864e5), est: true, ttm: +ttm.toFixed(3), last: b.last, wavg: b.wavg, chg: b.chg, curve: cy == null ? null : +cy.toFixed(4), vs: cy == null ? null : +((b.last - cy) * 100).toFixed(1) };
}).filter(Boolean).sort((a, b) => a.ttm - b.ttm) : (ncdWas.bonds || []);
const ncd = { name: "Negotiable certificates of deposit", cn: NCD.cn, curve: ncdCurve, tenors: ncdTenors, bonds: ncdBonds, tradeDay: ncdFresh ? dayOf(ncdTradeTime) : ncdWas.tradeDay || null, tradeTime: ncdFresh ? ncdTradeTime : ncdWas.tradeTime || null };

// 3b. Credit curves (latest day only) and the SOE / financial bonds traded today
const crWas = prev.credit || {};
const crCurves = {};
let tree = [];
try { const t = await post("https://yield.chinabond.com.cn/cbweb-mn/yc/queryTree?locale=zh_CN", CCDC, "", 20000); tree = Array.isArray(t) ? t : []; } catch (e) { log(`curve tree failed: ${e.message}`); }
const norm = (x = "") => x.replace(/[（(]/g, "(").replace(/[）)]/g, ")").replace(/\s/g, "");
const findId = (c) => {
  if (!tree.length) return c.id;
  let n = tree.find((x) => norm(x.name) === norm(c.cn));
  if (!n) { const base = norm(c.cn).replace(/\(.*\)$/, ""); n = tree.find((x) => norm(x.name).startsWith(base) && norm(x.name).includes((c.cn.match(/\((.*)\)/) || [])[1] || "AAA")) || tree.find((x) => norm(x.name) === base); }
  if (!n && c.k === "perp") n = tree.find((x) => /商业银行/.test(x.name) && /无固定期限|永续/.test(x.name) && /AA\+/.test(x.name)) || tree.find((x) => /商业银行/.test(x.name) && /无固定期限|永续/.test(x.name));
  if (n && String(n.isParent) === "true") { const ch = tree.filter((x) => x.pId === n.id); n = ch.find((x) => /AAA/.test(x.name)) || ch[0] || n; }
  return n?.id || c.id;
};
const crStart = Date.now();
for (const c of CR) {
  const was = crWas.curves?.[c.k];
  // CCDC publishes once a day (evening); re-read at most every 3 hours so the hourly site build stays fast
  if (was?.pts?.length && (was.date === today || Date.now() - (was.at || 0) < 3 * 3600e3)) { crCurves[c.k] = was; continue; }
  const id = findId(c);
  let got = null;
  for (let i = 0; i < 5 && id && !got && Date.now() - crStart < 90000; i++) {
    const d = addDays(today, -i);
    try { got = await curveOn(id, d, 20000, 5); } catch (e) { log(`${c.cn} ${d} failed: ${e.message}`); }
  }
  crCurves[c.k] = got ? { cn: c.cn, id, date: got.date, pts: got.pts, at: Date.now() } : was || null;
  log(`${c.cn}: ${got ? `${got.date}, ${got.pts.length} points` : crCurves[c.k] ? "kept previous" : "none"}${id ? "" : " (no id found)"}`);
}
const crFresh = Object.keys(crTrades).length > 0;
const crBonds = (grp) => crFresh ? Object.entries(crTrades).filter(([, b]) => b.grp === grp).map(([code, b]) => {
  const m = String(b.ttm || "").match(/([\d.]+)\s*([YD])/i), ttm = m ? (m[2].toUpperCase() === "D" ? +m[1] / 365 : +m[1]) : null;
  if (!(ttm > 0)) return null;
  const type = grp === "soe" ? soeType(b.nm) : finType(b.nm), ck = curveKey(grp, type), cv = ck && crCurves[ck]?.pts;
  const cy = cv ? interp(cv, ttm) : null, base = String(b.t || today).slice(0, 10);
  return { code, isin: b.isin, name: b.short, who: issuerOf(b.short), type, dep: depOf(type, b.nm), ck, mat: shDate(Date.parse(base + "T12:00:00+08:00") + ttm * 365.25 * 864e5), est: true, ttm: +ttm.toFixed(3), last: b.last, wavg: b.wavg, chg: b.chg, curve: cy == null ? null : +cy.toFixed(4), vs: cy == null || ttm < 0.05 ? null : +((b.last - cy) * 100).toFixed(1) }; // within ~18 days of maturity or call, yields are too noisy for a spread
}).filter(Boolean).sort((a, b) => a.ttm - b.ttm) : (crWas[grp]?.bonds || []);
const credit = {
  curves: Object.fromEntries(Object.entries(crCurves).filter(([, v]) => v).map(([k, v]) => [k, { cn: v.cn, date: v.date, pts: v.pts, at: v.at || Date.now() }])),
  soe: { name: "Central SOE bonds", bonds: crBonds("soe") }, fin: { name: "Financial bonds", bonds: crBonds("fin") },
  tradeDay: crFresh ? dayOf(crTradeTime) : crWas.tradeDay || null, tradeTime: crFresh ? crTradeTime : crWas.tradeTime || null,
};

// 4. Bonds: outstanding CGBs from the master list, plus anything traded that the list does not have yet
const typeOf = (n = "") => /贴现/.test(n) ? "Discount" : /超长期?特别/.test(n) ? "Ultra-long special" : /特别/.test(n) ? "Special" : /储蓄/.test(n) ? "Savings" : "Coupon";
const ttmYears = (mat, fallback) => {
  if (mat) return (Date.parse(mat) - Date.parse(today)) / (365.25 * 864e5);
  const m = String(fallback || "").match(/([\d.]+)\s*([YD])/i);
  return m ? (m[2].toUpperCase() === "D" ? +m[1] / 365 : +m[1]) : null;
};
const rows = new Map();
for (const b of Object.values(master.bonds || {})) {
  if (b.matured || !b.mat || b.mat < today) continue;
  if (/储蓄/.test(b.name || "")) continue; // savings bonds are not traded in the interbank market
  rows.set(b.code, { ...b });
}
for (const [code, tr] of Object.entries(trades)) if (!rows.has(code) && !/储蓄/.test(tr.name)) rows.set(code, { code, name: tr.name, isin: tr.isin });
const bonds = [];
for (const b of rows.values()) {
  const tr = trades[b.code] || {};
  const ttm = ttmYears(b.mat, tr.ttm);
  if (ttm == null || ttm <= 0) continue;
  const cy = curve ? interp(curve.pts, ttm) : null;
  const o = {
    code: b.code, isin: b.isin || tr.isin || null, name: b.name || tr.name || null, type: typeOf(b.name || tr.name),
    coupon: b.coupon ?? null, issue: b.issue || null, mat: b.mat || null, term: b.term || null, ttm: +ttm.toFixed(3),
    curve: cy == null ? null : +cy.toFixed(4),
    last: tr.last ?? null, wavg: tr.wavg ?? null, px: tr.px ?? null, chg: tr.chg ?? null,
  };
  o.vs = o.last != null && o.curve != null ? +((o.last - o.curve) * 100).toFixed(1) : null;
  bonds.push(o);
}
bonds.sort((a, b) => a.ttm - b.ttm || (a.code < b.code ? -1 : 1));

const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "ChinaBond (CCDC) China government bond yield curve (yield to maturity); bond list and ISINs from CFETS bond information; traded yields from the CFETS interbank cash-bond trade feed",
  curve, tenors, bonds, tradeDay: Object.keys(trades).length ? dayOf(tradeTime) : prev.tradeDay || null, tradeTime,
  masterUpdated: master.updated || null,
  pb, ncd, credit, pbTradeDay: pbFresh ? dayOf(pbTradeTime) : prev.pbTradeDay || null, pbTradeTime: pbFresh ? pbTradeTime : prev.pbTradeTime || null,
  pbSrc: "ChinaBond (CCDC) policy bank bond yield curves (中债政策性金融债收益率曲线: CDB 国开, ADBC 农发, EXIM 进出口; yield to maturity); traded yields from the CFETS interbank cash-bond trade feed",
};
mkdirSync("data", { recursive: true });
writeFileSync("data/china.json", JSON.stringify(out));
const msg = `China: CCDC curve ${curve?.date ?? "none"}, 10Y ${tenors[10]?.at(-1)?.[1] ?? "–"}; ${bonds.length} bonds (${bonds.filter((b) => b.isin).length} with ISIN, ${bonds.filter((b) => b.last != null).length} traded today); policy banks: ${PB.map((p) => `${p.short} ${pb[p.k].curve?.date ?? "none"} 10Y ${pb[p.k].tenors[10]?.at(-1)?.[1] ?? "–"} (${pb[p.k].bonds.length} traded, ${pb[p.k].reg.length} on register, ${pb[p.k].reg.filter((b) => b.est).length} estimated maturity)`).join(", ")}; NCDs: AAA curve ${ncdCurve?.date ?? "none"}, ${ncdBonds.length} traded (${ncd.tradeDay ?? "–"}); credit: ${credit.soe.bonds.length} SOE, ${credit.fin.bonds.length} financial (${credit.tradeDay ?? "–"}), curves ${Object.entries(credit.curves).map(([k, v]) => `${k} ${v.date}`).join(", ") || "none"}`;
log(msg); summary(`- ${msg}`);
if (!curve && !bonds.length) process.exit(1);
