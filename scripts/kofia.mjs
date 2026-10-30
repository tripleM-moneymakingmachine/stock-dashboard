// Shared helpers for the Korea tab: the Korea Financial Investment Association (KOFIA) bond information
// service (www.kofiabond.or.kr, "BIS"). Its pages call one XML endpoint with a service and function name and
// a flat DTO of val1..valN fields; the answer is a list of the same flat DTOs.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const URL_ = "https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/";
const H = { "User-Agent": UA, "Content-Type": "text/xml; charset=UTF-8", Accept: "application/xml, text/xml, */*", Referer: "https://www.kofiabond.or.kr/websquare/websquare.html", Origin: "https://www.kofiabond.or.kr" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one call; returns [{val1: "...", val2: "...", ...}] (empty fields dropped)
export async function kofia(svc, fn, dto, fields, { ms = 45000, tries = 3 } = {}) {
  const body = Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join("");
  const xml = `<?xml version="1.0" encoding="utf-8"?><message><proframeHeader><pfmAppName>BIS-KOFIABOND</pfmAppName><pfmSvcName>${svc}</pfmSvcName><pfmFnName>${fn}</pfmFnName></proframeHeader><systemHeader></systemHeader><${dto}>${body}</${dto}></message>`;
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(URL_, { method: "POST", headers: H, body: xml, signal: AbortSignal.timeout(ms) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseRows(await r.text());
    } catch (e) { err = e; await sleep(1500 * (i + 1)); }
  }
  throw new Error(`KOFIA ${svc}.${fn}: ${err?.message}`);
}
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
export function parseRows(xml) {
  const out = [];
  // innermost BIS...DTO blocks (no nested BIS elements) that carry val fields
  const re = /<(BIS\w*DTO)>((?:(?!<BIS)[\s\S])*?)<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const o = {}; let f;
    const fr = /<(val\d+)>([^<]*)<\/\1>/g;
    while ((f = fr.exec(m[2]))) { const v = unesc(f[2]).trim(); if (v !== "") o[f[1]] = v; }
    if (Object.keys(o).length) out.push(o);
  }
  return out;
}
export const num = (s) => { if (s == null) return null; const v = +String(s).replace(/,/g, "").trim(); return isFinite(v) ? v : null; };
export const iso = (s) => { const d = String(s || "").replace(/[^0-9]/g, ""); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null; };
export const ymd = (d) => d.replace(/-/g, "");
export const kst = (ms = Date.now()) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
export const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// KOFIA final-quote yields (최종호가수익률): announcement item codes
export const ITEMS = {
  3006: ["ktb", 1], 3019: ["ktb", 2], 3000: ["ktb", 3], 3007: ["ktb", 5], 3013: ["ktb", 10], 3014: ["ktb", 20], 3017: ["ktb", 30], 3018: ["ktb", 50],
  3015: ["msb", 0.25], 3016: ["msb", 1], 3003: ["msb", 2], 3004: ["kdb", 1], 3002: ["kepco", 3], 3008: ["nhb", 5],
  3009: ["aa", 3], 3010: ["bbb", 3], 4000: ["cd", 0.25], 5000: ["cp", 0.25],
};
// Daily history for up to six items per call (KOFIA's own limit). Returns {code: [[date, yield], ...]} ascending.
export async function finalQuoteHistory(codes, from, to) {
  const out = {};
  for (let i = 0; i < codes.length; i += 6) {
    const g = codes.slice(i, i + 6), f = { val1: "DD", val2: ymd(from), val3: ymd(to), val4: "1530" };
    g.forEach((c, j) => { f[`val${5 + j}`] = c; });
    const rows = await kofia("BISLastAskPrcROPSrchSO", "listTrm", "BISComDspDatDTO", f);
    g.forEach((c) => { out[c] = []; });
    for (const r of rows) {
      const d = iso(r.val1); if (!d) continue; // skips the high / low summary rows
      g.forEach((c, j) => { const y = num(r[`val${2 + j}`]); if (y != null && y > 0) out[c].push([d, y]); });
    }
    g.forEach((c) => out[c].sort((a, b) => a[0].localeCompare(b[0])));
  }
  return out;
}
// One day's final quotes for every item: {code: {am, pm, chg}}
export async function finalQuoteDay(d) {
  const rows = await kofia("BISLastAskPrcROPSrchSO", "listDay", "BISComDspDatDTO", { val1: ymd(d) });
  const out = {};
  for (const r of rows) if (r.val20 && ITEMS[r.val20]) out[r.val20] = { am: num(r.val3), pm: num(r.val4), chg: num(r.val5), name: r.val9 || r.val1 };
  return out;
}
// One day's OTC trades summarised by bond (일자별 거래현황): every bond traded over the counter that day.
export async function otcDay(d) {
  const rows = await kofia("BISCurTrdDescSrchSO", "listDay", "BISComDspDatDTO", { val1: ymd(d), val10: "B" });
  return rows.filter((r) => r.val20 && num(r.val6) != null).map((r) => ({
    d: iso(r.val1) || d, kind: r.val2 || "", name: (r.val3 || "").replace(/\s+/g, " ").trim(), rem: r.val4 || "", rating: r.val17 || "",
    y: num(r.val6), px: num(r.val7), hi: num(r.val8), lo: num(r.val9), mkt: r.val10 || "", vol: num(r.val11), amt: num(r.val12), n: num(r.val13), isin: r.val20,
  }));
}
// KTB futures delivery-basket bonds and their KOFIA yields on one day (국채선물수익률)
export async function futBasketDay(d) {
  const rows = await kofia("BISKTBFutSrchSO", "selectDay", "BISKTBFutDTO", { val1: ymd(d), val3: "13" });
  return rows.filter((r) => r.val10 && num(r.val3) != null).map((r) => ({ name: (r.val1 || "").replace(/\s+/g, " ").trim(), am: num(r.val2), pm: num(r.val3), chg: num(r.val4), prev: num(r.val5), isin: r.val10 }));
}
