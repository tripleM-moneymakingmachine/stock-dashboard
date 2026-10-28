// FX tab, "USD/TWD: equity flow signal": daily inputs for a Taiwan equity-flow indicator on USD/TWD, plus the
// back-tested signal (built by buildSignal below once the raw series are in).
//
// Raw inputs (daily, Taipei trading days):
//  - USD/TWD close (Yahoo Finance TWD=X)
//  - TAIEX close (Yahoo Finance ^TWII)
//  - Foreign investor (FINI, incl. mainland investors, excl. foreign dealers) net buy of TWSE-listed shares, TWD bn
//    (TWSE 三大法人買賣金額統計表 BFI82U, one call per trading day)
//  - Controls for the research: dollar index (DX-Y.NYB), USD/KRW (KRW=X)
//
// FINI history is cached in data/twd-flows.json and only missing days are fetched (TWSE rate-limits: ~2.5 s per call),
// so the first run back-fills about three years and later runs add a day or two.
// Usage: node scripts/fetch-twd-flows.mjs [--max N]   (N = most TWSE calls this run, default 900)
//        node scripts/fetch-twd-flows.mjs --build      (rebuild from the cached raw series, no network)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildSignal } from "./twd-signal.mjs";

const OUT = "data/twd-flows.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BEG = "2023-07-01";

let prev = null;
try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
const raw0 = prev?.raw || {};

async function get(url, headers = {}, ms = 20000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split("?")[0]}`);
  return r;
}

// ---------- Yahoo daily closes ----------
let cookie = "", crumb = "";
async function yahoo(sym, tz = "Asia/Taipei") {
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
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// ---------- TWSE FINI net buy ----------
async function finiDay(d) { // d = YYYY-MM-DD → TWD bn, or null when TWSE has no data (holiday)
  const u = `https://www.twse.com.tw/rwd/en/fund/BFI82U?type=day&dayDate=${d.replace(/-/g, "")}&response=json`;
  const j = await (await get(u, { Accept: "application/json", Referer: "https://www.twse.com.tw/en/" })).json();
  if (j.stat !== "OK" || !j.data?.length) return null;
  const row = j.data.find((r) => /^Foreign Investors/i.test(r[0])) || j.data.find((r) => /外資及陸資\(不含外資自營商\)/.test(r[0]));
  if (!row) throw new Error("no FINI row " + d);
  const n = (s) => +String(s).replace(/,/g, "") / 1e9;
  return [+n(row[1]).toFixed(3), +n(row[2]).toFixed(3), +n(row[3]).toFixed(3)]; // buy, sell, net
}

async function fetchRaw(maxCalls) {
  const out = { ...raw0 };
  const tryY = async (name, sym, tz) => { try { const v = await yahoo(sym, tz); log(`${name}: ${v.length} days, last ${v.at(-1)?.[0]}`); out[name] = v; } catch (e) { log(`${name} failed (${e.message}); keeping previous`); } };
  await tryY("usdtwd", "TWD=X");
  await tryY("taiex", "^TWII");
  await tryY("dxy", "DX-Y.NYB", "America/New_York");
  await tryY("usdkrw", "KRW=X");
  // FINI: one TWSE call per TAIEX trading day not yet cached (recent 5 days are always re-read in case of revisions)
  const have = new Map((out.fini || []).map((r) => [r[0], r]));
  const days = (out.taiex || []).map((r) => r[0]);
  const recent = new Set(days.slice(-5));
  const todo = days.filter((d) => !have.has(d) || recent.has(d)).reverse(); // newest first
  let calls = 0, fails = 0;
  for (const d of todo) {
    if (calls >= maxCalls) { log(`stopping after ${calls} TWSE calls; ${todo.length - calls} days left for the next run`); break; }
    calls++;
    try { const v = await finiDay(d); if (v) have.set(d, [d, ...v]); fails = 0; }
    catch (e) { log(`FINI ${d}: ${e.message}`); if (++fails >= 8) { log("too many TWSE failures; stopping"); break; } await sleep(10000); }
    await sleep(2600);
  }
  out.fini = [...have.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  log(`fini: ${out.fini.length} days, ${out.fini[0]?.[0]} to ${out.fini.at(-1)?.[0]} (${calls} calls)`);
  return out;
}

// ---------- run ----------
const mi = process.argv.indexOf("--max");
const raw = process.argv.includes("--build") ? raw0 : await fetchRaw(mi > 0 ? +process.argv[mi + 1] : 900);
if (!raw.usdtwd?.length || !raw.taiex?.length) { log(`missing USD/TWD or TAIEX; leaving ${OUT} unchanged`); process.exit(0); }
let built = {};
try { built = buildSignal(raw) || {}; } catch (e) { log("signal build failed:", e.message); built = prev ? Object.fromEntries(Object.entries(prev).filter(([k]) => !["raw", "updated"].includes(k))) : {}; }
const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "USD/TWD (TWD=X), TAIEX (^TWII), dollar index and USD/KRW: Yahoo Finance daily closes. Foreign investor net buy: TWSE 三大法人買賣金額統計表 (BFI82U), foreign and mainland investors excluding foreign dealers, TWD bn.",
  ...built,
  notes: prev?.notes || null,
  raw,
};
writeFileSync(OUT, JSON.stringify(out));
log(`wrote ${OUT}` + (built.latest ? `: signal ${built.latest.S} on ${built.latest.date}` : ""));
