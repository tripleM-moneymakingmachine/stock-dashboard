// PROBE 2 (temporary)
import { writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const B = "https://www.chinamoney.com.cn";
const H = (ref) => ({ "User-Agent": UA, Accept: "application/json, text/javascript, */*; q=0.01", Referer: ref, Origin: B, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" });
const out = [];
const note = (k, v, n = 3000) => { out.push(`### ${k}\n${String(v).slice(0, n)}\n`); };
const get = async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) }); return await r.text(); } catch (e) { return "ERR " + e.message; } };
const post = async (u, body, ref) => { try { const r = await fetch(u, { method: "POST", headers: H(ref), body, signal: AbortSignal.timeout(30000) }); return `[${r.status}] ` + await r.text(); } catch (e) { return "ERR " + e.message; } };
for (const p of ["/chinese/bkcurvuiruuh/", "/chinese/bkcurvfsw/"]) {
  const html = await get(B + p);
  const srcs = [...new Set([...html.matchAll(/(?:src|data-main)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]))];
  note("ALL SRCS " + p, srcs.join("\n"));
  const ctx = [...html.matchAll(/.{0,300}(?:ags\/ms|Hist?|\.json|ajax|\$\.post|url\s*:).{0,300}/g)].map((m) => m[0]);
  note("HTML CTX " + p, ctx.join("\n---\n"), 12000);
  for (const s of srcs.filter((s) => /\.js/.test(s) && !/jquery|grayscale|cm-gray|echarts\.min|bootstrap/i.test(s))) {
    const js = await get(s.startsWith("http") ? s : B + (s.startsWith("/") ? s : "/" + s));
    const c = [...js.matchAll(/.{0,500}(?:IuirCurvHis|SwpCurv|SwapCurv|fx-sw-curv|bkcurvfsw|Hist?["'])(?:.|\n){0,700}/g)].map((m) => m[0]);
    note("JS " + s + " len=" + js.length, c.join("\n---\n"), 12000);
  }
}
// IuirCurvHis param guesses
const ref = B + "/chinese/bkcurvuiruuh/";
const base = "startDate=2026-10-13&endDate=2026-11-11&pageNum=1&pageSize=50";
const combos = [
  "ccyPair=USD.CNY&rmdRate=23&bp=26&spotRate=28",
  "currencyPair=USD.CNY&rmdRate=23&bp=26&spotRate=28",
  "ccyPair=USD.CNY&rmdRateType=23&bpType=26&spotRateType=28",
  "currencyPair=USD.CNY&rmbRate=23&bp=26&spotRate=28",
  "ccyPair=USD.CNY&rmdRateTp=23&bpTp=26&spotRateTp=28",
  "ccyPair=USD.CNY&rmdRateId=23&bpId=26&spotRateId=28",
  "ccy=USD.CNY&rmdRate=23&bp=26&spotRate=28",
  "ccyPair=USD.CNY&rmdRate=23&bpRate=26&spotRate=28",
  "currency=USD.CNY&rmdRate=23&bp=26&spotRate=28",
  "ccyPair=USD.CNY&rmbRateType=23&swapPntType=26&spotRateType=28",
];
for (const c of combos) note("IUIR " + c, await post(`${B}/ags/ms/cm-u-bk-fx/IuirCurvHis`, `${base}&${c}&lang=CN`, ref), 1500);
for (const c of combos.slice(0, 3)) note("IUIR GETQS " + c, await post(`${B}/ags/ms/cm-u-bk-fx/IuirCurvHis?${base}&${c}&lang=CN`, "", ref), 1500);
// other fx history names
for (const n of ["FxSwpHis", "SwpHis", "FswHis", "SwpCurvHist", "FxSwpCurvHist", "CswpCurvHis", "FsCurvHis", "FxCurvHis", "SwpPntHis", "SwapHis"]) note("HIS " + n, await post(`${B}/ags/ms/cm-u-bk-fx/${n}`, `${base}&ccyPair=USD.CNY&currencyPair=USD.CNY`, B + "/chinese/bkcurvfsw/"), 300);
writeFileSync("data/_probe-fxswap.txt", out.join("\n"));
