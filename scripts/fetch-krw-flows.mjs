// FX tab, "USD/KRW: Korea equity flow signal": daily inputs for a Korea equity-flow indicator on USD/KRW, plus the
// back-tested signal (built by buildSignal in krw-signal.mjs once the raw series are in). Sister of fetch-twd-flows.mjs.
//
// Raw inputs (daily, Seoul trading days):
//  - USD/KRW close (Yahoo Finance KRW=X), dollar index (DX-Y.NYB) and USD/CNH (CNH=X): the dollar/yuan controls
//  - KOSPI close (Yahoo ^KS11) and KOSPI trading value (KRX, total of the buy side)
//  - KOSPI net buying by investor (KRX data marketplace, 투자자별 거래실적 일별추이 MDCSTAT02202, KRW → tn):
//    foreigners (외국인 + 기타외국인), retail (개인), institutions (기관 합계) and pension funds (연기금, mostly the NPS).
//    (Naver's desktop investorDealTrendDay / sise_index_day pages were retired in Nov 2026: HTTP 410.)
//
// History is cached in data/krw-flows.json; later runs only re-read the newest pages (the last few days are always
// re-read in case of revisions). Usage: node scripts/fetch-krw-flows.mjs [--pages N]  (most Naver pages per series)
//                                       node scripts/fetch-krw-flows.mjs --build      (rebuild offline from the cache)
import { readFileSync, writeFileSync } from "node:fs";
import { buildSignal } from "./krw-signal.mjs";

const OUT = "data/krw-flows.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BEG = "2023-07-01";
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const byDate = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
const raw0 = prev?.raw || {};

async function get(url, headers = {}, ms = 25000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split("?")[0]}`);
  return r;
}
const merge = (old, rows) => { const m = new Map(old || []); for (const r of rows) m.set(r[0], r); return [...m.values()].sort(byDate); };

// ---------- Yahoo daily closes ----------
let cookie = "", crumb = "";
async function yahoo(sym, tz = "Asia/Seoul") {
  if (!crumb) {
    try {
      const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(10000) });
      cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
      if (cookie) crumb = await (await get("https://query2.finance.yahoo.com/v1/test/getcrumb", { Cookie: cookie })).text();
    } catch (e) { log("yahoo crumb:", e.message); }
  }
  const q = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
  const r = await get(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1d${q}`, { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) });
  const res = (await r.json())?.chart?.result?.[0];
  if (!res) throw new Error("yahoo: empty " + sym);
  const ts = res.timestamp || [], cl = res.indicators?.quote?.[0]?.close || [];
  const m = new Map();
  ts.forEach((t, i) => { if (cl[i] == null) return; const d = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz }); if (d >= BEG) m.set(d, +(+cl[i]).toPrecision(7)); });
  return [...m.entries()].sort(byDate);
}

// ---------- KRX data marketplace (data.krx.co.kr) ----------
// MDCSTAT02202 = 투자자별 거래실적 일별추이 for the KOSPI market (mktId STK), trading value (trdVolVal 2), detailed view.
// askBid 3 = net buy, 2 = buy (its 전체 column is total market turnover). Values in KRW; returned as strings with commas.
const KRX = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const KRXH = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json, text/javascript, */*; q=0.01", Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020302", Origin: "https://data.krx.co.kr", "X-Requested-With": "XMLHttpRequest" };
const n0 = (s) => { const v = +String(s ?? "").replace(/[,\s]/g, ""); return isFinite(v) ? v : null; };
async function krxCall(form) {
  const r = await fetch(KRX, { method: "POST", headers: { "User-Agent": UA, ...KRXH }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(45000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  let j; try { j = JSON.parse(t); } catch { throw new Error(`not JSON: ${t.slice(0, 200)}`); }
  return j;
}
async function krxInvestor(from, to, askBid) {
  const j = await krxCall({ bld: "dbms/MDC/STAT/standard/MDCSTAT02202", locale: "ko_KR", inqTpCd: "2", trdVolVal: "2", askBid: String(askBid), mktId: "STK", etf: "EF", etn: "EN", elw: "EW", strtDd: from.replace(/-/g, ""), endDd: to.replace(/-/g, ""), detailView: "1", money: "1", csvxls_isNo: "false" });
  const rows = j.output || j.OutBlock_1 || j.block1 || [];
  if (!rows.length) throw new Error(`no rows: ${JSON.stringify(j).slice(0, 300)}`);
  return rows;
}
async function krxFlows(from, to) {
  const flows = [], turnover = []; let first = true;
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
    const a = y === +from.slice(0, 4) ? from : `${y}-01-01`, b = y === +to.slice(0, 4) ? to : `${y}-12-31`;
    const net = await krxInvestor(a, b, 3); await sleep(1500);
    const buy = await krxInvestor(a, b, 2); await sleep(1500);
    if (first) { log("KRX sample row:", JSON.stringify(net[0])); first = false; }
    // detailed columns: TRDVAL1 금융투자, 2 보험, 3 투신, 4 사모, 5 은행, 6 기타금융, 7 연기금, 8 기타법인, 9 개인,
    // 10 외국인, 11 기타외국인, TRDVAL_TOT 전체 (pykrx's layout). Institutions = 1–7.
    const tn = (x) => (x == null ? null : +(x / 1e12).toFixed(4));
    for (const r of net) {
      const d = String(r.TRD_DD || "").replace(/\//g, "-"); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const v = (k) => n0(r[k]);
      const inst = [1, 2, 3, 4, 5, 6, 7].reduce((s, k) => s + (v("TRDVAL" + k) ?? 0), 0);
      flows.push([d, tn((v("TRDVAL10") ?? 0) + (v("TRDVAL11") ?? 0)), tn(v("TRDVAL9")), tn(inst), tn(v("TRDVAL7"))]);
    }
    for (const r of buy) { const d = String(r.TRD_DD || "").replace(/\//g, "-"); const t = n0(r.TRDVAL_TOT); if (t > 0) turnover.push([d, +(t / 1e12).toFixed(3)]); }
    log(`KRX ${a}..${b}: ${net.length} net rows, ${buy.length} buy rows`);
  }
  flows.sort(byDate); turnover.sort(byDate);
  const big = flows.filter((f) => Math.abs(f[1] ?? 0) > 20).length; // foreign net > KRW 20 tn a day = wrong units
  if (big > flows.length / 4) throw new Error("KRX values look mis-scaled: " + JSON.stringify(flows.at(-1)));
  return { flows: flows.filter((r) => r[0] >= BEG), turnover };
}

async function fetchRaw(maxPages) {
  const out = { ...raw0 };
  const tryY = async (name, sym, tz) => {
    try {
      const v = await yahoo(sym, tz);
      const m = new Map(out[name] || []); for (const [d, c] of v) m.set(d, c);
      out[name] = [...m.entries()].sort(byDate);
      log(`${name}: Yahoo ${v.length} days, merged ${out[name].length}, last ${out[name].at(-1)?.[0]}`);
    } catch (e) { log(`${name} failed (${e.message}); keeping previous`); }
  };
  await tryY("usdkrw", "KRW=X");
  // Yahoo stamps ICE dollar-index bars at the session start (~20:00 New York the evening before), so dating them in
  // Seoul time lines each bar up with the same day's USD/KRW bar (dating in New York time shifts them a day early).
  await tryY("dxy", "DX-Y.NYB", "Asia/Seoul");
  // USD/CNH: Yahoo's CNH=X daily range has returned a single bar; fall back to USDCNH=X, then onshore CNY=X
  for (const sym of ["CNH=X", "USDCNH=X", "CNY=X"]) { await tryY("usdcnh", sym); if ((out.usdcnh?.length || 0) > 200) { out.cnhSym = sym; break; } log(`usdcnh: only ${out.usdcnh?.length || 0} days from ${sym}`); out.usdcnh = []; }
  // KOSPI close: Yahoo ^KS11 (KRX turnover is merged in below)
  try {
    const k = await yahoo("^KS11"); const old = new Map((out.kospi || []).map((r) => [r[0], r]));
    out.kospi = k.map(([d, c]) => [d, c, old.get(d)?.[2] ?? null]);
    log(`KOSPI: Yahoo ${k.length} days, last ${k.at(-1)?.[0]}`);
  } catch (e) { log("^KS11 failed:", e.message); }
  // investor net buying and market turnover: KRX 투자자별 거래실적 일별추이 (MDCSTAT02202), in yearly chunks;
  // only the newest chunk is re-read once history is cached
  try {
    const have = out.flows?.length > 200 ? out.flows.at(-10)[0] : BEG;
    const f = await krxFlows(have, kst());
    if (f.flows.length) {
      out.flows = merge(out.flows, f.flows);
      const tv = new Map(f.turnover); const m = new Map((out.kospi || []).map((r) => [r[0], r]));
      for (const [d, v] of tv) { const r = m.get(d); if (r) r[2] = v; }
      out.flowSrc = "krx";
    }
  } catch (e) { log("KRX investor flows failed:", e.message); }
  log(`kospi ${out.kospi?.length || 0} days (last ${out.kospi?.at(-1)?.[0]}), flows ${out.flows?.length || 0} days (last ${out.flows?.at(-1)?.[0]})`);
  return out;
}

// ---------- run ----------
const pi = process.argv.indexOf("--pages");
const raw = process.argv.includes("--build") ? raw0 : await fetchRaw(pi > 0 ? +process.argv[pi + 1] : 200);
if (!raw.usdkrw?.length || !raw.kospi?.length || !raw.flows?.length) { log(`missing USD/KRW, KOSPI or flows; leaving ${OUT} unchanged`); process.exit(0); }
let built = {};
try { built = buildSignal(raw) || {}; } catch (e) { log("signal build failed:", e.stack || e.message); built = prev ? Object.fromEntries(Object.entries(prev).filter(([k]) => !["raw", "updated", "notes", "src"].includes(k))) : {}; }
const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "USD/KRW (KRW=X), dollar index (DX-Y.NYB) and USD/CNH (CNH=X): Yahoo Finance daily closes. KOSPI close: Yahoo ^KS11. KOSPI trading value and net buying by investor type (foreigners, retail, institutions, pension funds): KRX data marketplace (투자자별 거래실적 일별추이), KRW tn.",
  ...built,
  notes: prev?.notes || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}` + (built.latest ? `: pressure ${built.latest.A}, exhaustion ${built.latest.C} on ${built.latest.date}` : ""));
