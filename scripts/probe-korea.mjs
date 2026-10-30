// Temporary: checks which Korean market-data endpoints answer from a GitHub Actions runner.
// Writes data/bench/korea-probe.json (status, size, first bytes of each response).
import { writeFileSync, mkdirSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const end = ymd(new Date(Date.now() - 86400e3)), start = ymd(new Date(Date.now() - 20 * 86400e3));
const krx = (bld, extra) => ({
  url: "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
  init: { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd", "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" }, body: new URLSearchParams({ bld, locale: "ko_KR", ...extra }).toString() },
});
const freesis = (obj) => ({
  url: "https://freesis.kofia.or.kr/meta/getMetaDataList.do",
  init: { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", Referer: "https://freesis.kofia.or.kr/", "User-Agent": UA }, body: JSON.stringify({ dmSearch: { tmpV40: "1000000", tmpV41: "1", tmpV1: "D", tmpV45: start, tmpV46: end, OBJ_NM: obj } }) },
});
const get = (url, ref) => ({ url, init: { headers: { "User-Agent": UA, ...(ref ? { Referer: ref } : {}) } } });

const P = {
  naver_ktb3y: get("https://finance.naver.com/marketindex/interestDailyQuote.naver?marketindexCd=IRR_GOVT03Y&page=1"),
  naver_ktb10y_m: get("https://m.stock.naver.com/front-api/marketIndex/prices?category=bond&reutersCode=KR10YT%3DRR&page=1"),
  naver_bondlist_m: get("https://m.stock.naver.com/front-api/marketIndex/bondList?nationType=KOR"),
  naver_kospi: get("https://fchart.stock.naver.com/sise.nhn?symbol=KOSPI&timeframe=day&count=30&requestType=0"),
  naver_deposit: get("https://finance.naver.com/sise/sise_deposit.naver"),
  naver_fut_ktb: get("https://m.stock.naver.com/api/index/FUT/basic"),
  krx_bond_kts: krx("dbms/MDC/STAT/standard/MDCSTAT09901", { mktId: "KTS", trdDd: end }),
  krx_fut_list: krx("dbms/MDC/STAT/standard/MDCSTAT12501", { trdDd: end, prodId: "KRDRVFUBM3", mktTpCd: "T", rghtTpCd: "T" }),
  krx_index: krx("dbms/MDC/STAT/standard/MDCSTAT00101", { idxIndMidclssCd: "02", trdDd: end, share: "2", money: "3" }),
  freesis_060: freesis("STATSCU0100000060BO"),
  freesis_070: freesis("STATSCU0100000070BO"),
  kofia_bis: get("https://www.kofiabond.or.kr/websquare/websquare.html?w2xPath=/xml/bondint/lastrop/BISLastAskPrcDay.xml"),
  ecos_sample: get(`https://ecos.bok.or.kr/api/StatisticSearch/sample/json/kr/1/10/817Y002/D/${start}/${end}/010200000`),
  krx_openapi: get(`https://data-dbg.krx.co.kr/svc/apis/bon/kts_bydd_trd?basDd=${end}`),
  seibro: get("https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/bond/BIP_CNTS03005V.xml&menuNo=78"),
  datagokr_bond: get("https://apis.data.go.kr/1160100/service/GetBondSecuritiesInfoService/getBondPriceInfo?resultType=json&numOfRows=1"),
  investing_ktb: get("https://api.investing.com/api/financialdata/historical/29287?start-date=2026-10-01&end-date=2026-10-30&time-frame=Daily&add-missing-rows=false", "https://www.investing.com/"),
  stooq_kr10y: get("https://stooq.com/q/d/l/?s=10krty.b&i=d"),
  yahoo_kospi: get("https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?range=1mo&interval=1d"),
  yahoo_krw: get("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d"),
  cnbc_kr10y: get("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=KR10Y-KR%7CKR3Y-KR%7CKR30Y-KR&requestMethod=itv&noform=1&output=json"),
  wsj_kr10y: get("https://www.wsj.com/market-data/quotes/bond/BX/TMBMKKR-10Y"),
  esignal_ktb: get("https://m.stock.naver.com/front-api/marketIndex/productDetail?category=bond&reutersCode=KR3YT%3DRR"),
};

const out = { at: new Date().toISOString(), start, end, r: {} };
await Promise.all(Object.entries(P).map(async ([k, { url, init }]) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
    const buf = Buffer.from(await r.arrayBuffer());
    let t = buf.toString("utf8"); if (/euc-kr/i.test(r.headers.get("content-type") || "")) t = new TextDecoder("euc-kr").decode(buf);
    out.r[k] = { s: r.status, ct: r.headers.get("content-type"), n: buf.length, head: t.replace(/\s+/g, " ").slice(0, 1200) };
  } catch (e) { out.r[k] = { err: String(e).slice(0, 200) }; }
}));
mkdirSync("data/bench", { recursive: true });
writeFileSync("data/bench/korea-probe.json", JSON.stringify(out, null, 1));
console.log(Object.entries(out.r).map(([k, v]) => `${k}: ${v.s ?? v.err} ${v.n ?? ""}`).join("\n"));
