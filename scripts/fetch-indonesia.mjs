// Indonesia tab data (data/indonesia.json), the Indonesian counterpart of data/korea.json:
//  - IGSYC curve: PHEI / IBPA (PT Penilai Harga Efek Indonesia) Indonesia Government Securities Yield Curve,
//    the official fair-value curve for rupiah government bonds, published each business day (today and yesterday,
//    0.1–40Y). PHEI does not publish history, so every run appends the day to the stored file; before the first
//    stored day the 10Y and 15Y run on CNBC's benchmark-bond yields (FR series) for five years.
//  - Bonds: every government bond on PHEI's securities register (series code, ISIN, outstanding, coupon, maturity),
//    the IGSYC curve at its remaining term, and PHEI's fair yield where PHEI publishes one (benchmark FR and PBS
//    series, retail ORI / SR), with the spread to the curve.
//  - Sukuk and credit curves (`pb`): government sukuk (PBS benchmarks) and retail SBN (ORI / SR) are fitted as a
//    Nelson-Siegel spread over IGSYC, the same method the Korea tab uses for its policy banks; corporate AAA, AA, A
//    and BBB curves are PHEI's own (0.1–10Y).
//  - Funding and credit (`mm`): BI-Rate decisions and JISDOR (Bank Indonesia), corporate credit spreads (PHEI).
// Anything that fails keeps the previous file's values. Usage: node scripts/fetch-indonesia.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const OUT = "data/indonesia.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const log = (...a) => console.log(...a);
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
const r4 = (v) => v == null || !isFinite(v) ? null : +(+v).toFixed(4);
const r1 = (v) => v == null || !isFinite(v) ? null : +(+v).toFixed(1);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const TEN = [0.1, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30]; // stored tenors (PHEI publishes 0.1 and every whole year)
const KEEP_DAYS = 5 * 366;

// ---------- http with a cookie jar (PHEI is an ASP.NET / DNN site: paging is a form postback) ----------
const jar = new Map();
async function http(url, { method = "GET", form, tries = 3 } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const headers = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,id;q=0.8", Accept: "text/html,application/json,*/*" };
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      let body;
      if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); headers.Referer = url; }
      const r = await fetch(url, { method, headers, body, redirect: "follow", signal: AbortSignal.timeout(45000) });
      for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const j = kv.indexOf("="); if (j > 0) jar.set(kv.slice(0, j).trim(), kv.slice(j + 1).trim()); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { log(`  ${url.slice(0, 90)} try ${i}: ${e.message}`); if (i === tries) throw e; await new Promise((s) => setTimeout(s, 2000 * i)); }
  }
}
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
// rows of the <table> whose id contains `idPart`, as arrays of cell text
function table(html, idPart) {
  const re = new RegExp(`<table[^>]*id="[^"]*${idPart}[^"]*"[\\s\\S]*?<\\/table>`, "i");
  const t = html.match(re)?.[0]; if (!t) return [];
  return (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map((c) => strip(c)));
}
const numEn = (s) => { const v = parseFloat(String(s).replace(/,/g, "")); return isFinite(v) ? v : null; };          // 7.6275
const numId = (s) => { const v = parseFloat(String(s).replace(/\./g, "").replace(",", ".")); return isFinite(v) ? v : null; }; // 14.019.751,00 / 10,250
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
function dateAny(s) { // 15-07-2027 | 24-Mei-2027 | 30-October-2026 | 30 Oktober 2026
  s = String(s).trim();
  let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/(\d{1,2})[-\s]+([A-Za-z]+)[-\s]+(\d{4})/); if (m) { const mo = MON[m[2].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}
const ttmOn = (mat, d) => (Date.parse(mat) - Date.parse(d)) / (365.25 * 864e5);
const prevWeekday = (d) => { let t = Date.parse(d); do t -= 864e5; while ([0, 6].includes(new Date(t).getUTCDay())); return new Date(t).toISOString().slice(0, 10); };

// ---------- curve maths (same as fetch-korea.mjs) ----------
function mono(pts) {
  const n = pts.length; if (n < 2) return () => (n ? pts[0][1] : null);
  const x = pts.map((p) => p[0]), y = pts.map((p) => p[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (t) => {
    if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1];
    let i = 0; while (t > x[i + 1]) i++;
    const h = x[i + 1] - x[i], s = (t - x[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}
const nsF = (t, tau = 2) => { const x = Math.max(t, 0.02) / tau; return (1 - Math.exp(-x)) / x; };
function fitSpread(obs) { // obs: [{t, s (bp), w}] → spread(t) = a + b·nsF(t)
  if (obs.length < 2) return null;
  const solve = (o) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const { t, s, w } of o) { const f = nsF(t); sw += w; sx += w * f; sy += w * s; sxx += w * f * f; sxy += w * f * s; }
    const det = sw * sxx - sx * sx, span = Math.max(...o.map((q) => q.t)) - Math.min(...o.map((q) => q.t));
    if (o.length < 4 || span < 1.5 || Math.abs(det) < 1e-9) return { a: sy / sw, b: 0 };
    const b = Math.max(-80, Math.min(80, (sw * sxy - sx * sy) / det));
    return { a: (sy - b * sx) / sw, b };
  };
  let o = obs, p = solve(o);
  for (let k = 0; k < 2 && o.length >= 6; k++) {
    const res = o.map((q) => Math.abs(q.s - (p.a + p.b * nsF(q.t))));
    const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)] || 0;
    const keep = o.filter((q, i) => res[i] <= Math.max(6, 3 * med));
    if (keep.length < 4 || keep.length === o.length) break;
    o = keep; p = solve(o);
  }
  return { ...p, n: o.length, tmax: Math.max(...o.map((q) => q.t)), tmin: Math.min(...o.map((q) => q.t)) };
}

// ---------- history store helpers ----------
const mapOf = (s) => new Map(s || []);
const putSer = (m, d, v) => { if (d && v != null && isFinite(v)) m.set(d, r4(v)); };
const toSer = (m, from) => [...m.entries()].filter(([d]) => !from || d >= from).sort((a, b) => a[0].localeCompare(b[0]));
const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);

// =====================================================================================================
// 1. PHEI fair prices and yield page: IGSYC, benchmark FR / PBS, retail ORI / SR, corporate curves
// =====================================================================================================
const HPW = "https://www.phei.co.id/en-us/Data/Fair-Prices-and-Yield";
let phei = null;
try {
  const h = await http(HPW);
  const txt = strip(h);
  const dm = txt.match(/Yield Curve per\s+(\d{1,2}-[A-Za-z]+-\d{4})/i) || txt.match(/per\s+(\d{1,2}[-\s][A-Za-z]+[-\s]\d{4})/i);
  const date = dm ? dateAny(dm[1]) : null;
  const curveRows = [...table(h, "gvTenor1"), ...table(h, "gvTenor2")].filter((r) => r.length >= 3 && isFinite(numEn(r[0])));
  const igs = curveRows.map((r) => [numEn(r[0]), numEn(r[1]), numEn(r[2])]).filter(([t, a]) => t != null && a != null);
  const ser = (id, kind) => table(h, id).slice(1).filter((r) => r.length >= 8 && r[1]).map((r) => ({ code: r[1], ttm: numEn(r[2]), y: numEn(r[3]), px: numEn(r[4]), y0: numEn(r[5]), px0: numEn(r[6]), coupon: numEn(r[7]), kind }));
  const fr = ser("gvPYGoverment_benchmark", "FR"), pbs = ser("GridView2", "PBS"), retail = ser("GridView1", "Retail");
  const csmRows = table(h, "gvCSM").slice(1).filter((r) => r.length >= 6 && r[1] !== "");
  const csm = csmRows.map((r) => r.filter((c, i) => i > 0 || c !== "")).map((r) => (r[0] === "" ? r.slice(1) : r)).map((r) => ({ t: numEn(r[0]), igs: numEn(r[1]), aaa: numEn(r[2]), aa: numEn(r[3]), a: numEn(r[4]), bbb: numEn(r[5]) })).filter((x) => x.t != null);
  if (!date || igs.length < 10) throw new Error(`IGSYC parse: date=${date} points=${igs.length}`);
  phei = { date, igs, fr, pbs, retail, csm };
  log(`PHEI ${date}: IGSYC ${igs.length} points (10Y ${igs.find(([t]) => t === 10)?.[1]}), FR ${fr.length}, PBS ${pbs.length}, retail ${retail.length}, corporate ${csm.length}`);
} catch (e) { log(`PHEI fair-price page failed: ${e.message}`); }

// =====================================================================================================
// 2. PHEI securities register: government bonds by code with ISIN (paged by ASP.NET postback)
// =====================================================================================================
const REGURL = "https://www.phei.co.id/Data/Informasi-Efek";
let register = prev.register || [];
try {
  const GRID = "gvObligasiPemerintah";
  const rows = new Map();
  const take = (h) => { let n = 0; for (const r of table(h, GRID).slice(1)) { const c = r[0] === "" ? r.slice(1) : r; if (c.length < 7 || !/^[A-Z]/.test(c[0]) || !/^ID/.test(c[2] || "")) continue; if (!rows.has(c[0])) { rows.set(c[0], { code: c[0], name: c[1], isin: c[2], ccy: c[3], out: numId(c[4]), coupon: numId(c[5]), mat: dateAny(c[6]) }); n++; } } return n; };
  const formOf = (h) => Object.fromEntries([...h.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)].map((m) => [m[0].match(/name="([^"]+)"/)?.[1], (m[0].match(/value="([^"]*)"/)?.[1] || "").replace(/&#43;/g, "+").replace(/&#47;/g, "/").replace(/&amp;/g, "&")]).filter(([k]) => k));
  let h = await http(REGURL); take(h);
  const target = h.match(/__doPostBack\(&#39;([^&]*gvObligasiPemerintah)&#39;,&#39;Page\$\d+/)?.[1] || h.match(/__doPostBack\('([^']*gvObligasiPemerintah)','Page\$\d+/)?.[1];
  log(`register page 1: ${rows.size} bonds; pager target ${target || "none"}`);
  if (target) {
    for (let p = 2; p <= 60; p++) {
      const f = formOf(h); f.__EVENTTARGET = target; f.__EVENTARGUMENT = `Page$${p}`;
      h = await http(REGURL, { method: "POST", form: f });
      const n = take(h); if (!n) { log(`register page ${p}: nothing new, stop`); break; }
      if (p % 5 === 0) log(`register page ${p}: ${rows.size} bonds`);
    }
  }
  if (rows.size >= 10) {
    const seen = new Map((prev.register || []).map((b) => [b.isin, b.first]));
    const today = new Date().toISOString().slice(0, 10);
    register = [...rows.values()].map((b) => ({ ...b, first: seen.get(b.isin) || (prev.register ? today : null) }));
    log(`register: ${register.length} government bonds`);
  } else log(`register: only ${rows.size} rows parsed; keeping the previous ${register.length}`);
} catch (e) { log(`PHEI register failed: ${e.message}; keeping the previous ${register.length}`); }

// =====================================================================================================
// 3. CNBC benchmark-bond yields: five years of daily 10Y and 15Y (history before PHEI days), quotes by tenor
// =====================================================================================================
const cnbc = {};
for (const [t, sym] of [[10, "ID10YT=RR"], [15, "ID15YT=RR"]]) {
  try {
    const end = new Date().toISOString().slice(0, 10).replace(/-/g, "") + "000000";
    const start = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10).replace(/-/g, "") + "000000";
    const j = JSON.parse(await http(`https://ts-api.cnbc.com/harmony/app/bars/${encodeURIComponent(sym)}/1D/${start}/${end}/adjusted/EST5EDT.json`));
    cnbc[t] = (j.barData?.priceBars || []).map((b) => [`${b.tradeTime.slice(0, 4)}-${b.tradeTime.slice(4, 6)}-${b.tradeTime.slice(6, 8)}`, +b.close]).filter(([, y]) => isFinite(y) && y > 0);
    log(`CNBC ${sym}: ${cnbc[t].length} days to ${cnbc[t].at(-1)?.[0]}`);
  } catch (e) { log(`CNBC ${sym} failed: ${e.message}`); }
}
let quotes = prev.cnbcQuotes || null;
try {
  const syms = { 1: "ID1YT=RR", 3: "ID3YT=RR", 5: "ID5YT=RR", 10: "ID10YT=RR", 15: "ID15YT=RR", 20: "ID20YT=RR", 30: "ID30YT=RR" };
  const j = JSON.parse(await http("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=" + encodeURIComponent(Object.values(syms).join("|")) + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json"));
  const by = new Map(j.FormattedQuoteResult.FormattedQuote.map((x) => [x.symbol, x]));
  quotes = Object.fromEntries(Object.entries(syms).map(([t, s]) => { const x = by.get(s); const y = parseFloat(x?.last); return [t, isFinite(y) ? { y, chg: parseFloat(x.change) || 0, mat: x.maturity_date || null, coupon: parseFloat(x.coupon) || null, time: x.last_time || null } : null]; }).filter(([, v]) => v));
} catch (e) { log(`CNBC quotes failed: ${e.message}`); }

// =====================================================================================================
// 4. Bank Indonesia: BI-Rate decisions and JISDOR (USD/IDR reference rate)
// =====================================================================================================
const biRate = mapOf(prev.mm?.series?.birate), jisdor = mapOf(prev.mm?.series?.jisdor);
let biDecisions = prev.biDecisions || [];
try {
  const h = await http("https://www.bi.go.id/id/statistik/indikator/bi-rate.aspx");
  const t = (h.match(/<table[\s\S]*?<\/table>/gi) || []).find((x) => /BI-Rate/i.test(x) && /Tanggal/i.test(x));
  const rows = t ? (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map((c) => strip(c))) : [];
  const dec = rows.map((r) => { const d = dateAny(r[1] || ""); const v = numId((r.find((c) => /%/.test(c)) || "").replace("%", "")); return d && v != null ? [d, v] : null; }).filter(Boolean);
  if (dec.length) { const m = new Map(biDecisions); for (const [d, v] of dec) m.set(d, v); biDecisions = toSer(m); log(`BI-Rate: ${dec.length} decisions on page, latest ${dec[0][0]} ${dec[0][1]}%`); }
} catch (e) { log(`BI-Rate failed: ${e.message}`); }
try {
  const h = await http("https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx");
  const t = (h.match(/<table[\s\S]*?<\/table>/gi) || []).find((x) => /Kurs/i.test(x) && /Tanggal/i.test(x));
  const rows = t ? (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map((c) => strip(c))) : [];
  let n = 0; for (const r of rows) { const d = dateAny(r[0] || ""); const v = numId((r[1] || "").replace(/Rp\s*/i, "")); if (d && v) { jisdor.set(d, v); n++; } }
  log(`JISDOR: ${n} days on page`);
} catch (e) { log(`JISDOR failed: ${e.message}`); }
// first run: back-fill JISDOR history from Yahoo's USD/IDR closes (labelled as such in the source note)
let jisdorBackfill = prev.jisdorBackfill || null;
if (jisdor.size < 60) {
  try {
    const j = JSON.parse(await http("https://query1.finance.yahoo.com/v8/finance/chart/IDR%3DX?range=5y&interval=1d"));
    const r = j.chart.result[0], ts = r.timestamp, c = r.indicators.quote[0].close;
    let n = 0; for (let i = 0; i < ts.length; i++) { const d = new Date(ts[i] * 1000).toISOString().slice(0, 10); if (c[i] && !jisdor.has(d)) { jisdor.set(d, +c[i].toFixed(0)); n++; } }
    jisdorBackfill = jisdor.size ? [...jisdor.keys()].sort()[0] : null; log(`USD/IDR back-fill from Yahoo: ${n} days`);
  } catch (e) { log(`USD/IDR back-fill failed: ${e.message}`); }
}
// BI-Rate as a daily step series from the decisions, over the history window
if (biDecisions.length) {
  const start = biDecisions[0][0], end = new Date().toISOString().slice(0, 10);
  let i = 0, v = biDecisions[0][1];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10); if ([0, 6].includes(new Date(t).getUTCDay())) continue;
    while (i + 1 < biDecisions.length && biDecisions[i + 1][0] <= d) { i++; v = biDecisions[i][1]; }
    if (biDecisions[i][0] <= d) biRate.set(d, v);
  }
}

// =====================================================================================================
// 5. Assemble: tenor history, today's curve, bonds, sukuk / retail / corporate curves, funding and credit
// =====================================================================================================
const tenMaps = Object.fromEntries(TEN.map((t) => [t, mapOf(prev.tenors?.[t])]));
const igsDays = new Set(prev.igsDays || []);
let curve = prev.curve || null, curveDate = prev.curve?.date || null, fNow = null;
if (phei) {
  const y0d = prev.curve?.date && prev.curve.date < phei.date ? prev.curve.date : prevWeekday(phei.date);
  const fT = mono(phei.igs.map(([t, y]) => [t, y])), fY = mono(phei.igs.map(([t, , y]) => [t, y]).filter(([, y]) => y != null));
  for (const t of TEN) { putSer(tenMaps[t], phei.date, fT(t)); if (!tenMaps[t].has(y0d)) putSer(tenMaps[t], y0d, fY(t)); }
  igsDays.add(phei.date); igsDays.add(y0d);
  fNow = fT; curveDate = phei.date;
  const pts = []; for (let t = 0.1; t <= 30.0001; t += t < 2 ? 0.05 : t < 10 ? 0.1 : 0.25) pts.push([+t.toFixed(2), r4(fT(t))]);
  curve = { date: phei.date, pts };
}
if (!fNow && curve?.pts?.length) fNow = mono(curve.pts);
// before PHEI days: CNBC benchmark yields for 10Y and 15Y (PHEI days always win)
const firstIgs = [...igsDays].sort()[0] || "9999";
for (const t of [10, 15]) for (const [d, y] of cnbc[t] || []) if (d < firstIgs && !tenMaps[t].has(d)) tenMaps[t].set(d, r4(y));
const tenors = Object.fromEntries(TEN.map((t) => [t, toSer(tenMaps[t], cutoff)]).filter(([, s]) => s.length));

// sukuk (PBS) and retail (ORI / SR) spreads over IGSYC; corporate curves straight from PHEI
const fitOf = (rows) => fNow ? fitSpread(rows.filter((b) => b.ttm > 0.05 && b.y != null).map((b) => ({ t: b.ttm, s: (b.y - fNow(b.ttm)) * 100, w: 1 }))) : null;
const pbPrev = prev.pb || {};
const issuerCurve = (fit, top) => { const pts = []; if (fit && fNow) for (let t = 0.1; t <= top + 1e-9; t += t < 2 ? 0.05 : 0.1) pts.push([+t.toFixed(2), r4(fNow(t) + (fit.a + fit.b * nsF(t)) / 100)]); return pts; };
const pbTen = (k, fn) => { const m = Object.fromEntries(TEN.map((t) => [t, mapOf(pbPrev[k]?.tenors?.[t])])); if (fn && curveDate) for (const t of TEN) { const v = fn(t); if (v != null) putSer(m[t], curveDate, v); } return Object.fromEntries(Object.entries(m).map(([t, s]) => [t, toSer(s, cutoff)]).filter(([, s]) => s.length)); };
const bondRow = (b, cf) => { const c = cf ? cf(b.ttm) : null; return { code: b.code, name: b.code, isin: regBy.get(b.code)?.isin || null, type: b.kind, coupon: b.coupon, mat: regBy.get(b.code)?.mat || null, ttm: r4(b.ttm), last: r4(b.y), px: b.px, chg: b.y0 != null ? r1((b.y - b.y0) * 100) : null, curve: r4(c), vs: c != null ? r1((b.y - c) * 100) : null }; };
const regBy = new Map(register.map((b) => [b.code, b]));
const pb = {};
if (phei) {
  const fitS = fitOf(phei.pbs), fitR = fitOf(phei.retail);
  const sTop = Math.max(10, Math.ceil(Math.max(...phei.pbs.map((b) => b.ttm || 0), 0))), rTop = Math.max(5, Math.ceil(Math.max(...phei.retail.map((b) => b.ttm || 0), 0)));
  const fS = fitS ? (t) => fNow(t) + (fitS.a + fitS.b * nsF(t)) / 100 : null, fR = fitR ? (t) => fNow(t) + (fitR.a + fitR.b * nsF(t)) / 100 : null;
  pb.sbsn = { short: "PBS sukuk", name: "Government sukuk (SBSN, PBS series)", local: "Surat Berharga Syariah Negara", fitted: true, fit: fitS ? { date: curveDate, levelBp: r1(fitS.a), slopeBp: r1(fitS.b), n: fitS.n } : null, curve: fitS ? { date: curveDate, pts: issuerCurve(fitS, Math.min(30, sTop)) } : null, tenors: pbTen("sbsn", fS ? (t) => (t <= sTop ? fS(t) : null) : null), bonds: phei.pbs.map((b) => bondRow(b, fS)) };
  pb.retail = { short: "Retail SBN", name: "Retail government bonds and sukuk (ORI, SR)", local: "SBN Ritel", fitted: true, fit: fitR ? { date: curveDate, levelBp: r1(fitR.a), slopeBp: r1(fitR.b), n: fitR.n } : null, curve: fitR ? { date: curveDate, pts: issuerCurve(fitR, rTop) } : null, tenors: pbTen("retail", fR ? (t) => (t <= rTop ? fR(t) : null) : null), bonds: phei.retail.map((b) => bondRow(b, fR)) };
  for (const [k, short, name] of [["aaa", "AAA", "Corporate AAA (idAAA)"], ["aa", "AA", "Corporate AA"], ["a", "A", "Corporate A"], ["bbb", "BBB", "Corporate BBB"]]) {
    const p = phei.csm.map((x) => [x.t, x[k]]).filter(([, y]) => y != null); if (p.length < 3) continue;
    const f = mono(p), top = p.at(-1)[0];
    const pts = []; for (let t = p[0][0]; t <= top + 1e-9; t += t < 2 ? 0.05 : 0.1) pts.push([+t.toFixed(2), r4(f(t))]);
    pb[k] = { short, name, local: "Kurva imbal hasil obligasi korporasi (PHEI)", fitted: false, curve: { date: curveDate, pts }, tenors: pbTen(k, (t) => (t <= top ? f(t) : null)), bonds: [] };
  }
} else Object.assign(pb, pbPrev);

// bonds by code and ISIN: the register, with PHEI fair yields where published
const fair = new Map(phei ? [...phei.fr, ...phei.pbs, ...phei.retail].map((b) => [b.code, b]) : (prev.bonds || []).filter((b) => b.last != null).map((b) => [b.code, { y: b.last, y0: b.last - (b.chg || 0) / 100, px: b.px, kind: b.type }]));
const typeOf = (code) => /^FR/.test(code) ? "FR (fixed rate)" : /^PBS/.test(code) ? "PBS (project sukuk)" : /^SPN(S)?/.test(code) ? (/^SPNS/.test(code) ? "SPNS (sukuk bill)" : "SPN (T-bill)") : /^VR/.test(code) ? "VR (variable rate)" : /^ORI/.test(code) ? "ORI (retail)" : /^SR/.test(code) ? "SR (retail sukuk)" : /^(ST|SBR|SWR)/.test(code) ? "Savings (non-tradable)" : /^IFR/.test(code) ? "IFR (ijarah sukuk)" : "Other";
const iss = (code) => /^(PBS|SPNS|IFR|SR|ST|SWR|SDHI|SNI)/.test(code) ? "SBSN" : "SUN";
const day = curveDate || new Date().toISOString().slice(0, 10);
const curveFor = (code, ttm) => { if (!fNow) return null; const k = /^PBS|^SPNS|^IFR/.test(code) ? "sbsn" : /^(ORI|SR)/.test(code) ? "retail" : null; const p = k && pb[k]?.fit; return fNow(ttm) + (p ? (p.levelBp + p.slopeBp * nsF(ttm)) / 100 : 0); };
const bonds = register.filter((b) => b.mat).map((b) => {
  const ttm = ttmOn(b.mat, day), f = fair.get(b.code), c = ttm > 0 ? curveFor(b.code, ttm) : null;
  return { code: b.code, isin: b.isin, name: b.name, type: typeOf(b.code), iss: iss(b.code), coupon: b.coupon, issue: b.first || null, mat: b.mat, ttm: r4(ttm), out: b.out, curve: r4(c), last: f ? r4(f.y) : null, px: f?.px ?? null, chg: f && f.y0 != null ? r1((f.y - f.y0) * 100) : null, vs: f && c != null ? r1((f.y - c) * 100) : null };
}).filter((b) => b.ttm > 0).sort((a, b) => a.ttm - b.ttm);
// PHEI-priced series missing from the register (e.g. new retail issues) still get a row
for (const [code, f] of fair) if (!bonds.some((b) => b.code === code) && f.ttm > 0) { const c = curveFor(code, f.ttm); bonds.push({ code, isin: null, name: code, type: typeOf(code), iss: iss(code), coupon: f.coupon ?? null, issue: null, mat: null, ttm: r4(f.ttm), out: null, curve: r4(c), last: r4(f.y), px: f.px ?? null, chg: f.y0 != null ? r1((f.y - f.y0) * 100) : null, vs: c != null ? r1((f.y - c) * 100) : null }); }
bonds.sort((a, b) => a.ttm - b.ttm);

// funding and credit: BI-Rate, JISDOR, IGSYC 3M (0.1Y) and corporate spreads over IGSYC at 1Y / 3Y / 5Y
const mmS = Object.fromEntries(["igs01", "aaa1", "aaa3", "aaa5", "aa3", "aa5", "a3", "bbb3", "igs3", "igs5"].map((k) => [k, mapOf(prev.mm?.series?.[k])]));
if (phei) {
  const csmAt = (k, t) => phei.csm.find((x) => x.t === t)?.[k] ?? null;
  putSer(mmS.igs01, curveDate, csmAt("igs", 0.1)); putSer(mmS.igs3, curveDate, csmAt("igs", 3)); putSer(mmS.igs5, curveDate, csmAt("igs", 5));
  for (const [k, c, t] of [["aaa1", "aaa", 1], ["aaa3", "aaa", 3], ["aaa5", "aaa", 5], ["aa3", "aa", 3], ["aa5", "aa", 5], ["a3", "a", 3], ["bbb3", "bbb", 3]]) putSer(mmS[k], curveDate, csmAt(c, t));
}
const mm = { series: { birate: toSer(biRate, cutoff), jisdor: toSer(jisdor, cutoff), ...Object.fromEntries(Object.entries(mmS).map(([k, m]) => [k, toSer(m, cutoff)])) } };

const out = {
  updated: Math.floor(Date.now() / 1000),
  src: "PHEI / IBPA (PT Penilai Harga Efek Indonesia): Indonesia Government Securities Yield Curve (IGSYC), fair yields and prices, securities register; CNBC benchmark-bond yields (history before the first stored PHEI day); Bank Indonesia (BI-Rate, JISDOR)",
  curve, tenors, igsDays: [...igsDays].filter((d) => d >= cutoff).sort(), cnbcFrom: firstIgs === "9999" ? null : firstIgs,
  bonds, register,
  tradeDay: curveDate, prevTradeDay: tenors[10]?.length > 1 ? tenors[10].at(-2)[0] : null, tradeTime: curveDate ? `${curveDate} PHEI close` : null,
  benchmarks: phei ? { fr: phei.fr.map((b) => bondRow(b, fNow)), pbs: (pb.sbsn?.bonds || []), date: curveDate } : prev.benchmarks || null,
  cnbcQuotes: quotes,
  pb, mm, biDecisions, jisdorBackfill,
  pbTradeDay: curveDate, pbSrc: "PBS sukuk and retail ORI / SR: IGSYC plus a Nelson-Siegel spread fitted to PHEI's fair yields for the series it prices. Corporate AAA–BBB: PHEI's corporate bond yield curves by rating",
  counts: { register: register.length, sun: bonds.filter((b) => b.iss === "SUN").length, sbsn: bonds.filter((b) => b.iss === "SBSN").length, priced: bonds.filter((b) => b.last != null).length },
};
if (!out.curve) { log("No IGSYC curve at all; not writing."); process.exit(0); }
writeFileSync(OUT, JSON.stringify(out));
const t10 = tenors[10]?.at(-1);
log(`wrote ${OUT}: curve ${curve.date}, 10Y ${t10?.[1]} (${tenors[10]?.length} days), bonds ${bonds.length} (${out.counts.priced} priced), BI-Rate ${mm.series.birate.at(-1)?.[1]}, JISDOR ${mm.series.jisdor.at(-1)?.join(" ")}`);
summary(`Indonesia: IGSYC ${curve.date}, 10Y ${t10?.[1]}%, ${bonds.length} bonds, ${out.counts.priced} with PHEI fair yields`);
