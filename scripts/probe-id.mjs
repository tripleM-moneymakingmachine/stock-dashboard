// Probe round 2: dig into the sources that answered in round 1.
import { Agent } from 'undici';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const insecure = new Agent({ connect: { rejectUnauthorized: false } }); // DJPPR serves a cert with the wrong host name

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

async function get(url, opt = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9,id;q=0.8', ...(opt.headers || {}) }, method: opt.method || 'GET', body: opt.body, redirect: 'follow', signal: AbortSignal.timeout(40000), dispatcher: opt.dispatcher });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, status: r.status, ct: r.headers.get('content-type') || '', url: r.url, buf, txt: buf.toString('utf8'), ms: Date.now() - t0, setCookie: r.headers.getSetCookie?.() || [] };
  } catch (e) { return { ok: false, err: `${e.name}: ${e.message} ${e.cause ? (e.cause.code || e.cause.message) : ''}`, ms: Date.now() - t0 }; }
}
const head = (n, r, url) => console.log(`\n### ${n}\nURL   ${url}\n` + (r.ok ? `HTTP  ${r.status}  ${r.ct}  ${r.buf.length} bytes  ${r.ms}ms  final=${r.url}` : `ERROR ${r.err}`));

function tables(html, max = 6, rows = 25) {
  const out = [];
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const trs = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map((c) => strip(c).trim()).join(' | '));
    if (trs.length) out.push(`TABLE (${trs.length} rows) id=${(t.match(/id="([^"]+)"/) || [])[1] || ''}\n    ` + trs.slice(0, rows).join('\n    '));
    if (out.length >= max) break;
  }
  return out.join('\n');
}
function forms(html) {
  const ins = [...html.matchAll(/<(input|select)[^>]*name="([^"]+)"[^>]*>/gi)].map((m) => `${m[1]}:${m[2]}`).filter((s) => !/VIEWSTATE|EVENTVALIDATION|dnn\$dnnSEARCH/i.test(s));
  const opts = [...html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/gi)].map((m) => `${m[1]} → ` + [...m[0].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/gi)].slice(0, 12).map((o) => `${o[1]}=${o[2].trim()}`).join(', '));
  return `FORM FIELDS ${ins.slice(0, 50).join('  ')}\nSELECTS\n  ${opts.join('\n  ')}`;
}

console.log('probe-id round 2', new Date().toISOString());

// 1. PHEI fair price & yield page: every table (IGSYC, benchmark/retail fair prices, sukuk?), form fields for a date picker
for (const [n, u] of [['PHEI HPW (id)', 'https://www.phei.co.id/Data/HPW-dan-Imbal-Hasil'], ['PHEI HPW (en)', 'https://www.phei.co.id/en-us/Data/Fair-Prices-and-Yield']]) {
  const r = await get(u); head(n, r, u);
  if (r.ok) {
    console.log(tables(r.txt, 10, 40)); console.log(forms(r.txt));
    const links = [...new Set([...r.txt.matchAll(/(?:href|src)="([^"]*(?:\.xls|\.xlsx|\.csv|\.zip|\.pdf|Download|LinkClick|ashx|Handler)[^"]*)"/gi)].map((m) => m[1]))];
    console.log('FILE LINKS\n  ' + links.slice(0, 40).join('\n  '));
    const body = strip(r.txt); const i = body.search(/Benchmark|Sukuk|SBSN|PBS|FR0/i);
    console.log('TEXT@series ' + body.slice(Math.max(0, i - 100), i + 2500));
  }
}
// PHEI other data pages
for (const [n, u] of [['PHEI Indeks', 'https://www.phei.co.id/Data/Indeks'], ['PHEI CSM', 'https://www.phei.co.id/Data/Credit-Spread-Matrix'], ['PHEI Informasi Efek', 'https://www.phei.co.id/Data/Informasi-Efek'], ['PHEI IGBF', 'https://www.phei.co.id/Data/IGBF']]) {
  const r = await get(u); head(n, r, u);
  if (r.ok && r.status === 200) { console.log(tables(r.txt, 4, 15)); console.log(forms(r.txt).slice(0, 1500)); }
}

// 2. CNBC: daily bars for each tenor symbol, and quotes for alternative symbol forms
const syms = ['ID1YT=RR', 'ID2YT=RR', 'ID3YT=RR', 'ID5YT=RR', 'ID7YT=RR', 'ID10YT=RR', 'ID15YT=RR', 'ID20YT=RR', 'ID25YT=RR', 'ID30YT=RR'];
for (const s of syms) {
  const u = `https://ts-api.cnbc.com/harmony/app/bars/${encodeURIComponent(s)}/1D/20210101000000/20261031000000/adjusted/EST5EDT.json`;
  const r = await get(u);
  let info = r.ok ? `HTTP ${r.status}` : r.err;
  try { const b = JSON.parse(r.txt).barData.priceBars || []; info += `  bars=${b.length}  first=${b[0]?.tradeTime} ${b[0]?.close}  last=${b.at(-1)?.tradeTime} ${b.at(-1)?.close}`; } catch { info += '  ' + (r.txt || '').slice(0, 150); }
  console.log(`CNBC bars ${s}: ${info}`);
}
const q = await get('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' + encodeURIComponent(syms.join('|') + '|IDGV5YUSAC=R|ID5YUSAC=R|IDN5YCDS|IDRUSD=X|USDIDR=X|.JKSE|IDNF1M=|IDR1MNDF=') + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json');
try { for (const x of JSON.parse(q.txt).FormattedQuoteResult.FormattedQuote) console.log(`CNBC quote ${x.symbol}: code=${x.code} last=${x.last} time=${x.last_time} mat=${x.maturity_date} cpn=${x.coupon} name=${x.name}`); } catch { console.log('CNBC quote parse failed ' + (q.txt || q.err || '').slice(0, 300)); }

// 3. Bank Indonesia: tables on the indicator pages
for (const [n, u] of [['BI rate', 'https://www.bi.go.id/id/statistik/indikator/bi-rate.aspx'], ['BI INDONIA', 'https://www.bi.go.id/id/statistik/indikator/indonia.aspx'], ['BI INDONIA-JIBOR', 'https://www.bi.go.id/id/fungsi-utama/moneter/indonia-jibor/default.aspx'], ['BI JISDOR', 'https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx'], ['BI SRBI', 'https://www.bi.go.id/id/fungsi-utama/moneter/srbi/default.aspx']]) {
  const r = await get(u); head(n, r, u);
  if (r.ok) { console.log(tables(r.txt, 4, 12)); const f = forms(r.txt); console.log(f.slice(0, 1200)); const xl = [...new Set([...r.txt.matchAll(/(?:href)="([^"]*(?:\.xls|\.xlsx|\.csv|Download|\.pdf)[^"]*)"/gi)].map((m) => m[1]))]; console.log('FILE LINKS\n  ' + xl.slice(0, 15).join('\n  ')); }
}

// 4. DJPPR with the certificate check off (host-name mismatch only)
for (const [n, u] of [['DJPPR home', 'https://www.djppr.kemenkeu.go.id/'], ['DJPPR no-www', 'https://djppr.kemenkeu.go.id/'], ['DJPPR ownership', 'https://www.djppr.kemenkeu.go.id/kepemilikansbn'], ['DJPPR auction', 'https://www.djppr.kemenkeu.go.id/hasillelangsun'], ['DJPPR sbsn auction', 'https://www.djppr.kemenkeu.go.id/hasillelangsbsn']]) {
  const r = await get(u, { dispatcher: insecure }); head(n, r, u);
  if (r.ok) {
    const body = strip(r.txt);
    console.log('TITLE ' + ((r.txt.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').trim());
    const links = [...new Set([...r.txt.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]).filter((h) => /lelang|kepemilikan|ownership|xls|pdf|sbn|sun|sbsn|data|statistik|download|api/i.test(h)))];
    console.log('LINKS\n  ' + links.slice(0, 50).join('\n  '));
    console.log(tables(r.txt, 3, 12));
    console.log('TEXT ' + body.slice(0, 800));
  }
}

// 5. WorldGovernmentBonds JSON API (Indonesia curve, CDS)
for (const [n, u, body] of [
  ['WGB wp-json root', 'https://www.worldgovernmentbonds.com/wp-json/'],
  ['WGB country api', 'https://www.worldgovernmentbonds.com/wp-json/country/v1/main', JSON.stringify({ GLOBALVAR: { JS_VARIABLE: 'jsGlobalVars', FUNCTION: 'Country', DOMESTIC: true, ENDPOINT: 'https://www.worldgovernmentbonds.com/wp-json/country/v1/historical', DATE_RIF: '2099-12-31', OBJ: null, COUNTRY1: { SYMBOL: '17', PAESE: 'Indonesia', PAESE_UPPERCASE: 'INDONESIA', BANDIERA: 'id', URL_PAGE: 'indonesia' }, COUNTRY2: null, OBJ1: null, OBJ2: null } })],
]) {
  const r = await get(u, body ? { method: 'POST', body, headers: { 'Content-Type': 'application/json', Referer: 'https://www.worldgovernmentbonds.com/country/indonesia/', Origin: 'https://www.worldgovernmentbonds.com' } } : {});
  head(n, r, u); if (r.ok) console.log('BODY ' + r.txt.slice(0, n.includes('root') ? 600 : 2500));
}
