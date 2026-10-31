/* Indonesia tab: "Funding and credit" (port of assets/korea-mm.js). Indonesia publishes no bond lending fee and
   INDONIA is not machine-readable on Bank Indonesia's site, so this section tracks what is public and moves INDOGBs:
   the BI-Rate, the short end of PHEI's IGSYC curve, JISDOR (BI's USD/IDR reference rate, the foreign-flow channel),
   and PHEI's corporate credit curves (AAA to BBB) over IGSYC.
   Data: data/indonesia.json → mm.series (scripts/fetch-indonesia.mjs). */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("mmTiles") || !window.LightweightCharts) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const sgn = (v, d = 1) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const cls = (v) => v == null || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down";
  const RNG = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 1100 };
  // [key, label, series or [a, b] spread (b − a, bp), colour]
  const LINES = {
    rates: [["birate", "BI-Rate", "birate", "--c6"], ["igs01", "IGSYC 1M", "igs01", "--c1"], ["igs3", "IGSYC 3Y", "igs3", "--c4"], ["aaa3", "Corp AAA 3Y", "aaa3", "--c2"]],
    money: [["s01", "IGSYC 1M − BI-Rate", ["birate", "igs01"], "--c1"], ["s3", "IGSYC 3Y − BI-Rate", ["birate", "igs3"], "--c4"], ["s53", "IGSYC 5Y − 3Y", ["igs3", "igs5"], "--c3"]],
    credit: [["aaa", "AAA 3Y − IGSYC 3Y", ["igs3", "aaa3"], "--c1"], ["aa", "AA 3Y − IGSYC 3Y", ["igs3", "aa3"], "--c4"], ["a", "A 3Y − IGSYC 3Y", ["igs3", "a3"], "--c2"], ["bbb", "BBB − AA 3Y", ["aa3", "bbb3"], "--c5"]],
    fx: [["jisdor", "USD/IDR (JISDOR)", "jisdor", "--c1"]],
  };
  const st = { mode: "rates", rng: "6M" };
  let S, ch, sers = [], legFn = null;
  const opts = () => ({ autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 }, localization: { locale: "en-US" } });
  const serOf = (spec) => {
    if (typeof spec === "string") return S[spec] || [];
    const A = new Map(S[spec[0]] || []); return (S[spec[1]] || []).filter(([d]) => A.has(d)).map(([d, y]) => [d, +((y - A.get(d)) * 100).toFixed(1)]);
  };
  const back = (s, days) => { const c = new Date(Date.parse(s.at(-1)[0]) - days * 864e5).toISOString().slice(0, 10); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= c) return s[i][1]; return null; };
  const fmtV = (mode, v) => mode === "fx" ? Math.round(v).toLocaleString("en-US") : mode === "rates" ? v.toFixed(3) + "%" : sgn(v) + " bp";

  fetch("../data/indonesia.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d?.mm?.series) return;
    S = d.mm.series; tiles(); draw(); table(d);
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
  });
  function tiles() {
    const T = [["birate", "BI-Rate", "birate", "r"], ["igs01", "IGSYC 1M", "igs01", "r"], ["jisdor", "USD/IDR JISDOR", "jisdor", "fx"], ["aaa", "AAA 3Y spread", ["igs3", "aaa3"], "s"], ["aa", "AA 3Y spread", ["igs3", "aa3"], "s"], ["bbb", "BBB vs AA 3Y", ["aa3", "bbb3"], "s"]];
    $("mmTiles").innerHTML = T.map(([k, l, spec, u]) => {
      const s = serOf(spec); if (!s.length) return "";
      const last = s.at(-1)[1], p1 = s.length > 1 ? s.at(-2)[1] : null, w = back(s, 7), m = back(s, 30);
      if (u === "fx") { const pc = (x) => x ? (last / x - 1) * 100 : null; return `<div class="tile"><b>${esc(l)}</b><span class="v">${Math.round(last).toLocaleString("en-US")}</span><span class="c ${cls(pc(p1))}">${sgn(pc(p1), 2)}% 1D</span><small>1W ${sgn(pc(w), 2)} · 1M ${sgn(pc(m), 2)}%</small></div>`; }
      const f = (x) => x == null ? null : u === "s" ? last - x : (last - x) * 100;
      return `<div class="tile"><b>${esc(l)}</b><span class="v">${u === "s" ? sgn(last) + " bp" : last.toFixed(3) + "%"}</span><span class="c ${cls(f(p1))}">${sgn(f(p1))} bp 1D</span><small>1W ${sgn(f(w))} · 1M ${sgn(f(m))} bp</small></div>`;
    }).join("");
  }
  function draw() {
    const b = (id, list, key) => { $(id).innerHTML = list.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${st[key] === k}">${l}</button>`).join(""); $(id).querySelectorAll("button").forEach((x) => x.onclick = () => { st[key] = x.dataset.k; draw(); }); };
    b("mmMode", [["rates", "Policy and curve rates"], ["money", "Curve vs BI-Rate"], ["credit", "Credit spreads"], ["fx", "Rupiah (JISDOR)"]], "mode");
    b("mmRng", Object.keys(RNG).map((r) => [r, r]), "rng");
    if (!ch) { ch = LightweightCharts.createChart($("mmChart"), opts()); ch.subscribeCrosshairMove((q) => legFn && legFn(q?.time || null)); } else ch.applyOptions(opts());
    sers.forEach((s) => ch.removeSeries(s)); sers = [];
    const mode = st.mode, prec = mode === "fx" ? 0 : mode === "rates" ? 3 : 1;
    const lines = LINES[mode].map(([k, l, spec, c]) => { const s = serOf(spec); const cut = s.length ? new Date(Date.parse(s.at(-1)[0]) - RNG[st.rng] * 864e5).toISOString().slice(0, 10) : ""; return { l, col: css(c), data: s.filter(([d]) => d >= cut) }; });
    lines.forEach((x) => { const s = ch.addLineSeries({ color: x.col, lineWidth: 2, priceLineVisible: false, lineType: x.l === "BI-Rate" ? 1 : 0, priceFormat: { type: "price", precision: prec, minMove: Math.pow(10, -prec) } }); s.setData(x.data.map(([time, value]) => ({ time, value }))); sers.push(s); });
    ch.timeScale().fitContent();
    legFn = (t) => { $("mmLeg").innerHTML = lines.map((x) => { const v = t ? x.data.find(([d]) => d === t) : x.data.at(-1); return `<span><i style="background:${x.col};height:2.5px"></i>${esc(x.l)} <b>${v ? fmtV(mode, v[1]) : "–"}</b></span>`; }).join("") + `<span class="mut">${esc(t || lines[0]?.data.at(-1)?.[0] || "")}</span>`; };
    legFn(null);
    const short = lines.filter((x) => x.data.length < 20).length;
    $("mmNote").textContent = {
      rates: "BI-Rate from Bank Indonesia's decision table (a step line). IGSYC 1M and 3Y are points on PHEI's government curve; Corp AAA 3Y is PHEI's AAA corporate curve.",
      money: "How far the government curve sits above the policy rate. The 1M point trades close to BI's money-market operations (SRBI and the deposit facility); a wide 3Y − BI-Rate gap means the market is pricing hikes or a term premium for rupiah risk.",
      credit: "PHEI's corporate curves by rating over IGSYC at 3 years (PHEI's credit spread matrix). AAA is the investment-grade benchmark; BBB over AA is the high-yield premium. Spreads widening while IGSYC falls usually means risk-off.",
      fx: "JISDOR, Bank Indonesia's daily USD/IDR reference rate; before the dashboard's first stored day, Yahoo's USD/IDR close. A weaker rupiah (line up) has gone with foreign selling of INDOGBs.",
    }[mode] + (short ? " PHEI publishes no history, so lines from PHEI curves start on the first day the dashboard stored them and lengthen daily." : "");
  }
  function table(d) {
    const R = [["BI-Rate", "birate"], ["IGSYC 1M (0.1Y)", "igs01"], ["IGSYC 3Y", "igs3"], ["IGSYC 5Y", "igs5"], ["Corp AAA 1Y", "aaa1"], ["Corp AAA 3Y", "aaa3"], ["Corp AAA 5Y", "aaa5"], ["Corp AA 3Y", "aa3"], ["Corp AA 5Y", "aa5"], ["Corp A 3Y", "a3"], ["Corp BBB 3Y", "bbb3"]].filter(([, k]) => S[k]?.length);
    $("mmTab").innerHTML = R.map(([l, k]) => {
      const s = S[k], last = s.at(-1)[1], dd = (x) => x == null ? null : (last - x) * 100, y1 = s.length > 200 ? back(s, 365) : null, ys = s.filter(([dt]) => dt >= new Date(Date.parse(s.at(-1)[0]) - 366 * 864e5).toISOString().slice(0, 10)).map((x) => x[1]);
      return `<tr><td>${esc(l)}</td><td><b>${last.toFixed(3)}</b></td><td class="${cls(dd(s.at(-2)?.[1]))}">${sgn(dd(s.at(-2)?.[1]))}</td><td class="${cls(dd(back(s, 7)))}">${sgn(dd(back(s, 7)))}</td><td class="${cls(dd(back(s, 30)))}">${sgn(dd(back(s, 30)))}</td><td class="${cls(dd(y1))}">${sgn(dd(y1))}</td><td>${Math.min(...ys).toFixed(3)} – ${Math.max(...ys).toFixed(3)}${s.length < 200 ? ` <small class="mut">(since ${esc(s[0][0])})</small>` : ""}</td></tr>`;
    }).join("");
    const bd = (d.biDecisions || []).slice(-6).reverse().map(([dt, v]) => `${dt} ${v.toFixed(2)}%`).join(" · ");
    if (bd && $("mmDec")) $("mmDec").textContent = `Recent BI-Rate decisions: ${bd}.`;
  }
})();
