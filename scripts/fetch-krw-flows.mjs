// FX tab, "USD/KRW: Korea equity flow signal": daily inputs for a Korea equity-flow indicator on USD/KRW, plus the
// back-tested signal (built by buildSignal in krw-signal.mjs once the raw series are in). Sister of fetch-twd-flows.mjs.
//
// Raw inputs (daily, Seoul trading days):
//  - USD/KRW close (Yahoo Finance KRW=X), dollar index (DX-Y.NYB) and USD/CNH (CNH=X): the dollar/yuan controls
//  - KOSPI close and trading value (Naver Finance sise_index_day, 거래대금 KRW mn → tn), Yahoo ^KS11 as a close fallback
//  - KOSPI net buying by investor (Naver Finance investorDealTrendDay, sosok=01, 억원 → KRW tn): foreigners (외국인),
//    retail (개인), institutions (기관계) and pension funds (연기금등, mostly the NPS)
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

// ---------- Naver Finance pages (EUC-KR HTML tables) ----------
const cells = (tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
const num = (s) => { const v = +String(s).replace(/[,+\s]/g, ""); return s !== "" && isFinite(v) ? v : null; };
const isoDate = (s) => { // "2026.11.05" or "26.11.05"
  const m = String(s).match(/^(\d{2}|\d{4})\.(\d{2})\.(\d{2})$/); if (!m) return null;
  return `${m[1].length === 2 ? "20" + m[1] : m[1]}-${m[2]}-${m[3]}`;
};
async function naverPage(url) {
  const r = await get(url, { Referer: "https://finance.naver.com/sise/" });
  const t = new TextDecoder("euc-kr").decode(await r.arrayBuffer());
  return [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cells(m[1])).filter((c) => c.length && isoDate(c[0]));
}
// Page through a Naver daily table, newest first, until rows reach `stop` (already cached and older than the
// re-read window) or BEG, or `maxPages` pages.
async function naverPaged(name, urlFor, parse, stop, maxPages) {
  const out = []; let last = null;
  for (let p = 1; p <= maxPages; p++) {
    let rows;
    try { rows = await naverPage(urlFor(p)); }
    catch (e) { log(`${name} page ${p}: ${e.message}`); await sleep(4000); try { rows = await naverPage(urlFor(p)); } catch (e2) { log(`${name}: giving up at page ${p}`); break; } }
    if (!rows.length) break;
    const key = rows.map((c) => c[0]).join();
    if (key === last) break; // Naver repeats the last page past the end
    last = key;
    for (const c of rows) { const v = parse(c); if (v) out.push(v); }
    const oldest = isoDate(rows.at(-1)[0]);
    if (p === 1) log(`${name}: page 1 sample ${JSON.stringify(rows[0])}`);
    if (oldest < BEG || (stop && oldest < stop)) break;
    await sleep(350);
  }
  log(`${name}: ${out.length} rows read, ${out.at(-1)?.[0]} to ${out[0]?.[0]}`);
  return out;
}
// KOSPI daily: 날짜 | 체결가 | 전일비 | 등락률 | 거래량(천주) | 거래대금(백만) → [date, close, turnover KRW tn]
const kospiRow = (c) => { const d = isoDate(c[0]), cl = num(c[1]), tv = num(c[5]); return d && cl > 0 ? [d, cl, tv > 0 ? +(tv / 1e6).toFixed(3) : null] : null; };
// Investor net buy, 억원: 날짜 | 개인 | 외국인 | 기관계 | 금융투자 | 보험 | 투신(사모) | 은행 | 기타금융기관 | 연기금등 | 기타법인
//   → [date, foreign, retail, institutions, pension] in KRW tn
const flowRow = (c) => {
  const d = isoDate(c[0]), v = c.slice(1).map(num);
  if (!d || v.length < 9 || v[1] == null) return null;
  const tn = (x) => (x == null ? null : +(x / 1e4).toFixed(4));
  return [d, tn(v[1]), tn(v[0]), tn(v[2]), tn(v[8])];
};

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
  await tryY("usdcnh", "CNH=X");
  // re-read anything newer than 7 sessions before the last cached day
  const reread = (rows) => (rows?.length > 10 ? rows.at(-8)[0] : null);
  try {
    const k = await naverPaged("KOSPI", (p) => `https://finance.naver.com/sise/sise_index_day.naver?code=KOSPI&page=${p}`, kospiRow, reread(out.kospi), maxPages);
    if (k.length) out.kospi = merge(out.kospi, k.filter((r) => r[0] >= BEG));
  } catch (e) { log("KOSPI failed:", e.message); }
  if (!out.kospi?.length) { // fallback: Yahoo close only
    try { out.kospi = (await yahoo("^KS11")).map(([d, c]) => [d, c, null]); log("KOSPI from Yahoo ^KS11 (no turnover)"); } catch (e) { log("^KS11 failed:", e.message); }
  }
  try {
    const biz = kst().replace(/-/g, "");
    const f = await naverPaged("investor flows", (p) => `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${biz}&sosok=01&page=${p}`, flowRow, reread(out.flows), maxPages);
    if (f.length) out.flows = merge(out.flows, f.filter((r) => r[0] >= BEG));
  } catch (e) { log("investor flows failed:", e.message); }
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
  src: "USD/KRW (KRW=X), dollar index (DX-Y.NYB) and USD/CNH (CNH=X): Yahoo Finance daily closes. KOSPI close and trading value: Naver Finance (KRX). KOSPI net buying by investor type (foreigners, retail, institutions, pension funds): Naver Finance 투자자별 매매동향 (KRX data), KRW tn.",
  ...built,
  notes: prev?.notes || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}` + (built.latest ? `: pressure ${built.latest.A}, exhaustion ${built.latest.C} on ${built.latest.date}` : ""));
