// Probe which Indonesian bond / market data sources GitHub Actions can reach.
// For each URL: status, content type, size, final URL, a text sample, and (for HTML) links worth following.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LINK_RE = /(xls|xlsx|csv|json|api|ashx|download|igsyc|yield|kurva|imbal|hpw|harga|lelang|auction|kepemilikan|ownership|srbi|indonia|jibor|bi-rate|birate|sbn|sukuk|pbs|portals)/i;

const T = [
  // PHEI / IBPA (official valuation agency; IGSYC curve, fair prices per series)
  ['PHEI home', 'https://www.phei.co.id/'],
  ['PHEI en home', 'https://www.phei.co.id/en-us/'],
  ['PHEI data', 'https://www.phei.co.id/Data'],
  ['PHEI yield curve', 'https://www.phei.co.id/Data/Yield-Curve'],
  ['PHEI HPW', 'https://www.phei.co.id/Data/HPW-dan-Imbal-Hasil'],
  ['PHEI IGSYC', 'https://www.phei.co.id/Data/IGSYC'],
  // IDX (publishes IGSYC and bond data)
  ['IDX IGSYC page', 'https://www.idx.co.id/id/data-pasar/obligasi-sukuk/indonesia-government-securities-yield-curve-igsyc/'],
  ['IDX IGSYC api 1', 'https://www.idx.co.id/primary/BondSukuk/GetIgsyc'],
  ['IDX IGSYC api 2', 'https://www.idx.co.id/primary/BondSukuk/GetIndonesiaGovernmentSecuritiesYieldCurve'],
  ['IDX IGSYC api 3', 'https://www.idx.co.id/primary/IndonesiaGovernmentSecuritiesYieldCurve/GetData'],
  ['IDX bond list api', 'https://www.idx.co.id/primary/ListedBond/GetBondSukuk?start=0&length=10'],
  ['IDX JCI chart', 'https://www.idx.co.id/primary/Home/GetIndexList'],
  // DJPPR (Ministry of Finance: auctions, foreign ownership of SBN, series list)
  ['DJPPR home', 'https://www.djppr.kemenkeu.go.id/'],
  ['DJPPR ownership', 'https://www.djppr.kemenkeu.go.id/kepemilikansbn'],
  ['DJPPR auction SUN', 'https://www.djppr.kemenkeu.go.id/hasillelangsun'],
  ['DJPPR data SBN', 'https://www.djppr.kemenkeu.go.id/datasbn'],
  // Bank Indonesia (BI Rate, INDONIA, JIBOR, JISDOR, SRBI)
  ['BI rate', 'https://www.bi.go.id/id/statistik/indikator/bi-rate.aspx'],
  ['BI INDONIA', 'https://www.bi.go.id/id/statistik/indikator/indonia.aspx'],
  ['BI JISDOR', 'https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx'],
  ['BI SRBI', 'https://www.bi.go.id/id/fungsi-utama/moneter/srbi/default.aspx'],
  // Yahoo (already used by fetch-quote.mjs): JCI, USD/IDR, Indonesia ETF
  ['Yahoo JCI', 'https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=5d&interval=1d'],
  ['Yahoo USDIDR', 'https://query1.finance.yahoo.com/v8/finance/chart/IDR%3DX?range=5d&interval=1d'],
  ['Yahoo EIDO', 'https://query1.finance.yahoo.com/v8/finance/chart/EIDO?range=5d&interval=1d'],
  // CNBC (sovereign yields by tenor)
  ['CNBC quote ID tenors', 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=ID1YT%3DRR%7CID2YT%3DRR%7CID3YT%3DRR%7CID5YT%3DRR%7CID10YT%3DRR%7CID15YT%3DRR%7CID20YT%3DRR%7CID30YT%3DRR&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json'],
  ['CNBC bars ID10Y', 'https://ts-api.cnbc.com/harmony/app/bars/ID10YT%3DRR/1D/20251001000000/20261031000000/adjusted/EST5EDT.json'],
  ['CNBC quote ID CDS', 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=ID5YCDS%3DR&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json'],
  // Others
  ['Investing ID10Y hist', 'https://www.investing.com/rates-bonds/indonesia-10-year-bond-yield-historical-data'],
  ['WGB Indonesia', 'https://www.worldgovernmentbonds.com/country/indonesia/'],
  ['ADB ABO Indonesia', 'https://asianbondsonline.adb.org/indonesia/'],
  ['Pasardana bonds', 'https://pasardana.id/api/BondSearchResult/GetAll'],
  ['CNBC Indonesia bonds', 'https://www.cnbcindonesia.com/market-data/bonds'],
  ['US Treasury (control)', 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv'],
];

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9,id;q=0.8' },
      redirect: 'follow', signal: AbortSignal.timeout(30000),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    const txt = buf.toString('utf8');
    console.log(`\n### ${name}\nURL   ${url}\nFINAL ${r.url}\nHTTP  ${r.status}  ${ct}  ${buf.length} bytes  ${Date.now() - t0}ms`);
    const cf = /cf-chl|challenge-platform|Just a moment|Attention Required/i.test(txt);
    if (cf) console.log('NOTE  Cloudflare challenge page');
    if (/html/i.test(ct)) {
      const title = (txt.match(/<title[^>]*>([^<]*)/i) || [])[1];
      console.log('TITLE', (title || '').trim().slice(0, 120));
      const links = new Set();
      for (const m of txt.matchAll(/(?:href|src|data-url|action)\s*=\s*["']([^"'#]+)["']/gi)) if (LINK_RE.test(m[1])) links.add(m[1]);
      for (const m of txt.matchAll(/["'](\/?(?:api|primary|Portals|DesktopModules|umbraco)[^"'\s]{3,160})["']/g)) links.add(m[1]);
      const arr = [...links].slice(0, 60);
      if (arr.length) console.log('LINKS\n  ' + arr.join('\n  '));
      const body = txt.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const i = body.search(/yield|imbal|tenor|FR0\d|BI.?Rate|INDONIA|JISDOR|kepemilikan/i);
      console.log('TEXT  ' + body.slice(Math.max(0, i - 200), Math.max(0, i - 200) + 1200));
    } else {
      console.log('BODY  ' + txt.slice(0, 1500));
    }
  } catch (e) {
    console.log(`\n### ${name}\nURL   ${url}\nERROR ${e.name}: ${e.message}${e.cause ? ' / ' + (e.cause.code || e.cause.message) : ''}  ${Date.now() - t0}ms`);
  }
}

console.log('probe-id run', new Date().toISOString());
for (const [n, u] of T) await probe(n, u);
