// FX tab, "USD/KRW: Korea equity flow signal": daily inputs for a Korea equity-flow indicator on USD/KRW, plus the
// back-tested signal (built by buildSignal in krw-signal.mjs once the raw series are in). Sister of fetch-twd-flows.mjs.
//
// Raw inputs (daily, Seoul trading days):
//  - USD/KRW close (Yahoo Finance KRW=X), dollar index (DX-Y.NYB) and USD/CNH (CNH=X): the dollar/yuan controls
//  - KOSPI close (Yahoo ^KS11) and KOSPI trading value (KRX, total of the buy side)
//  - KOSPI net buying by investor (KRX 투자자별 거래실적 일별추이, KRW → tn):
//    foreigners (외국인 + 기타외국인), retail (개인), institutions (기관 합계) and pension funds (연기금, mostly the NPS).
//    via scripts/krx-flows.py (pykrx, KRX member login from the KRX_ID/KRX_PW secrets). Until those are set, the
//    panel runs in macro-only mode (USD/KRW vs KOSPI and the dollar/yuan/Korea split, no flow signals).
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

// ---------- KRX investor flows (via scripts/krx-flows.py, which logs in with KRX_ID/KRX_PW) ----------
// KRX's data marketplace has needed a member login since Dec 2025, and Naver's desktop flow pages answer GitHub's
// runners with HTTP 410, so the investor series come from pykrx in the workflow's previous step.
const KRX_TMP = "data/.krx-flows.tmp.json";

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
  // investor net buying and KOSPI turnover from the pykrx step (if it ran)
  try {
    const f = JSON.parse(readFileSync(KRX_TMP, "utf8"));
    if (f.flows?.length) {
      out.flows = merge(out.flows, f.flows.filter((r) => r[0] >= BEG));
      const m = new Map((out.kospi || []).map((r) => [r[0], r])); let n = 0;
      for (const [d, v] of f.turnover || []) { const r = m.get(d); if (r) { r[2] = v; n++; } }
      out.flowSrc = "krx"; log(`KRX (pykrx): ${f.flows.length} flow days, turnover on ${n} days`);
    }
  } catch { log("no KRX investor data this run (KRX_ID/KRX_PW secrets not set, or the pykrx step failed)"); }
  log(`kospi ${out.kospi?.length || 0} days (last ${out.kospi?.at(-1)?.[0]}), flows ${out.flows?.length || 0} days (last ${out.flows?.at(-1)?.[0]})`);
  return out;
}

// ---------- run ----------
const pi = process.argv.indexOf("--pages");
const raw = process.argv.includes("--build") ? raw0 : await fetchRaw(pi > 0 ? +process.argv[pi + 1] : 200);
if (!raw.usdkrw?.length || !raw.kospi?.length) { log(`missing USD/KRW, KOSPI or flows; leaving ${OUT} unchanged`); process.exit(0); }
let built = {};
try { built = buildSignal(raw) || {}; } catch (e) { log("signal build failed:", e.stack || e.message); built = prev ? Object.fromEntries(Object.entries(prev).filter(([k]) => !["raw", "updated", "notes", "src"].includes(k))) : {}; }
const out = {
  flowSrc: raw.flowSrc || null,
  updated: Math.floor(Date.now() / 1000),
  src: "USD/KRW (KRW=X), dollar index (DX-Y.NYB) and USD/CNH (CNH=X): Yahoo Finance daily closes. KOSPI close: Yahoo ^KS11. KOSPI trading value and net buying by investor type (foreigners, retail, institutions, pension funds): KRX data marketplace (투자자별 거래실적 일별추이), KRW tn.",
  ...built,
  notes: prev?.notes || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}` + (built.latest ? `: pressure ${built.latest.A}, exhaustion ${built.latest.C} on ${built.latest.date}` : ""));
