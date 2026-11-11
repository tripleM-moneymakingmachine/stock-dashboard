// PROBE (temporary): discover CFETS FX swap curve endpoints. Writes data/_probe-fxswap.txt
import { writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const H = (ref) => ({ "User-Agent": UA, Accept: "application/json, text/javascript, */*; q=0.01", Referer: ref, Origin: "https://www.chinamoney.com.cn", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" });
const out = [];
const note = (k, v) => { out.push(`### ${k}\n${String(v).slice(0, 2500)}\n`); console.log(k, String(v).slice(0, 300)); };
async function go(label, url, { method = "POST", body = "", ref = "https://www.chinamoney.com.cn/chinese/bkcurvfsw/" } = {}) {
  try {
    const r = await fetch(url, { method, headers: method === "GET" ? { "User-Agent": UA, Referer: ref } : H(ref), body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    note(`${label} [${r.status}] ${url} ${body}`, t);
    return t;
  } catch (e) { note(`${label} ERR ${url}`, e.message); return ""; }
}
const B = "https://www.chinamoney.com.cn";
// pages and their scripts
for (const p of ["/chinese/bkcurvfsw/", "/chinese/bkcurvfswhis/", "/chinese/bkcurvuiruuh/", "/chinese/bkcurvuir/", "/english/bmkycvfsc/"]) {
  const html = await go("PAGE", B + p, { method: "GET" });
  const srcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).filter((s) => !/jquery|echarts|bootstrap|common\/lib/i.test(s));
  note("SCRIPTS " + p, srcs.join("\n"));
  const hrefs = [...html.matchAll(/href="([^"]*(?:his|His)[^"]*)"/g)].map((m) => m[1]);
  note("HIS LINKS " + p, hrefs.join("\n"));
  for (const s of srcs.slice(0, 12)) {
    const js = await go("JS", s.startsWith("http") ? s : B + s, { method: "GET" });
    const hits = [...new Set([...js.matchAll(/["'`]([^"'`]*(?:ags\/ms|\/data\/fx|Curv|curv)[^"'`]*)["'`]/g)].map((m) => m[1]))];
    note("JS HITS " + s, hits.join("\n"));
    const params = [...new Set([...js.matchAll(/(\w+)\s*:\s*[^,}\n]{0,40}/g)].map((m) => m[1]))].slice(0, 80);
    note("JS KEYS " + s, params.join(", "));
  }
}
// current curve files
for (const f of ["fx-c-sw-curv-USD.CNY.json", "fx-sw-curv-USD.CNY.json", "rfx-sw-quot.json", "fx-sw-curv.json"]) await go("STATIC", `${B}/r/cms/www/chinamoney/data/fx/${f}`, { body: "t=" + Date.now() });
// history candidates
const d1 = "2026-10-01", d2 = "2026-11-11";
const qs = [`startDate=${d1}&endDate=${d2}&currencyPair=USD.CNY&pageNum=1&pageSize=50`, `startDate=${d1}&endDate=${d2}&ccyPair=USD.CNY&pageNum=1&pageSize=50`, `startDate=${d1}&endDate=${d2}&pageNum=1&pageSize=50&lang=CN`];
for (const n of ["SwpCurvHis", "SwapCurvHis", "FxSwpCurvHis", "FswCurvHis", "SwCurvHis", "CSwpCurvHis", "FxSwapCurvHis", "SwpCurvHisNew", "IuirCurvHis", "UirCurvHis"]) {
  for (const q of qs) await go("HIS " + n, `${B}/ags/ms/cm-u-bk-fx/${n}`, { body: q, ref: `${B}/chinese/bkcurvfswhis/` });
}
await go("SHIBOR HIS", `${B}/ags/ms/cm-u-bk-shibor/ShiborHis?lang=cn&startDate=${d1}&endDate=${d2}`, { ref: `${B}/chinese/bkshibor/` });
await go("CCPR HIS", `${B}/ags/ms/cm-u-bk-ccpr/CcprHisNew?startDate=${d1}&endDate=${d2}&currency=USD/CNY&pageNum=1&pageSize=50`, { ref: `${B}/chinese/bkccpr/` });
writeFileSync("data/_probe-fxswap.txt", out.join("\n"));
