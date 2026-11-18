/* Malaysia tab: "Funding and credit" (port of assets/indonesia-mm.js). Malaysia publishes no bond lending fee, so
   this section tracks what is public and moves MGS: Bank Negara Malaysia's OPR, Treasury bill yields and the short end
   of the FAST MGS curve, the GII − MGS gap, the KL USD/MYR reference rate (the foreign-flow channel), and FAST's
   corporate curves by rating over MGS.
   Data: data/malaysia.json → mm.series (scripts/fetch-malaysia.mjs). */
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
    rates: [["opr", "OPR", "opr", "--c6"], ["mtb1", "T-bill ~1M", "mtb1", "--c1"], ["mgs3", "MGS 3Y", "mgs3", "--c4"], ["aaa3", "Corp AAA 3Y", "aaa3", "--c2"]],
    money: [["s01", "T-bill ~1M − OPR", ["opr", "mtb1"], "--c1"], ["s3", "MGS 3Y − OPR", ["opr", "mgs3"], "--c4"], ["s103", "MGS 10Y − 3Y", ["mgs3", "mgs10"], "--c3"]],
    gii: [["g3", "GII 3Y − MGS 3Y", ["mgs3", "gii3"], "--c1"], ["g10", "GII 10Y − MGS 10Y", ["mgs10", "gii10"], "--c4"]],
    credit: [["aaa", "AAA 3Y − MGS 3Y", ["mgs3", "aaa3"], "--c1"], ["aa1", "AA1 3Y − MGS 3Y", ["mgs3", "aa13"], "--c4"], ["a", "A 3Y − MGS 3Y", ["mgs3", "a3"], "--c2"], ["bbb", "BBB − AA 3Y", ["aa3", "bbb3"], "--c5"]],
    fx: [["usdmyr", "USD/MYR (KL reference rate)", "usdmyr", "--c1"]],
  };
  const st = { mode: "rates", rng: "6M" };
  let S, ch, sers = [], legFn = null;
  const opts = () => ({ autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 }, localization: { locale: "en-US" } });
  const serOf = (spec) => {
    if (typeof spec === "string") return S[spec] || [];
    const A = new Map(S[spec[0]] || []); return (S[spec[1]] || []).filter(([d]) => A.has(d)).map(([d, y]) => [d, +((y - A.get(d)) * 100).toFixed(1)]);
  };
  const back = (s, days) => { const c = new Date(Date.parse(s.at(-1)[0]) - days * 864e5).toISOString().slice(0, 10); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= c) return s[i][1]; return null; };
  const fmtV = (mode, v) => mode === "fx" ? v.toFixed(4) : mode === "rates" ? v.toFixed(3) + "%" : sgn(v) + " bp";

  fetch("../data/malaysia.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d?.mm?.series) return;
    S = d.mm.series; tiles(); draw(); table(d);
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
  });
  function tiles() {
    const T = [["opr", "OPR", "opr", "r"], ["mtb1", "T-bill ~1M", "mtb1", "r"], ["usdmyr", "USD/MYR (KL ref.)", "usdmyr", "fx"], ["aaa", "AAA 3Y spread", ["mgs3", "aaa3"], "s"], ["g10", "GII − MGS 10Y", ["mgs10", "gii10"], "s"], ["bbb", "BBB vs AA 3Y", ["aa3", "bbb3"], "s"]];
    $("mmTiles").innerHTML = T.map(([k, l, spec, u]) => {
      const s = serOf(spec); if (!s.length) return "";
      const last = s.at(-1)[1], p1 = s.length > 1 ? s.at(-2)[1] : null, w = back(s, 7), m = back(s, 30);
      if (u === "fx") { const pc = (x) => x ? (last / x - 1) * 100 : null; return `<div class="tile"><b>${esc(l)}</b><span class="v">${last.toFixed(4)}</span><span class="c ${cls(pc(p1))}">${sgn(pc(p1), 2)}% 1D</span><small>1W ${sgn(pc(w), 2)} · 1M ${sgn(pc(m), 2)}%</small></div>`; }
      const f = (x) => x == null ? null : u === "s" ? last - x : (last - x) * 100;
      return `<div class="tile"><b>${esc(l)}</b><span class="v">${u === "s" ? sgn(last) + " bp" : last.toFixed(3) + "%"}</span><span class="c ${cls(f(p1))}">${sgn(f(p1))} bp 1D</span><small>1W ${sgn(f(w))} · 1M ${sgn(f(m))} bp</small></div>`;
    }).join("");
  }
  function draw() {
    const b = (id, list, key) => { $(id).innerHTML = list.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${st[key] === k}">${l}</button>`).join(""); $(id).querySelectorAll("button").forEach((x) => x.onclick = () => { st[key] = x.dataset.k; draw(); }); };
    b("mmMode", [["rates", "Policy and curve rates"], ["money", "Curve vs OPR"], ["gii", "GII vs MGS"], ["credit", "Credit spreads"], ["fx", "Ringgit (USD/MYR)"]], "mode");
    b("mmRng", Object.keys(RNG).map((r) => [r, r]), "rng");
    if (!ch) { ch = LightweightCharts.createChart($("mmChart"), opts()); ch.subscribeCrosshairMove((q) => legFn && legFn(q?.time || null)); } else ch.applyOptions(opts());
    sers.forEach((s) => ch.removeSeries(s)); sers = [];
    const mode = st.mode, prec = mode === "fx" ? 4 : mode === "rates" ? 3 : 1;
    const lines = LINES[mode].map(([k, l, spec, c]) => { const s = serOf(spec); const cut = s.length ? new Date(Date.parse(s.at(-1)[0]) - RNG[st.rng] * 864e5).toISOString().slice(0, 10) : ""; return { l, col: css(c), data: s.filter(([d]) => d >= cut) }; });
    lines.forEach((x) => { const s = ch.addLineSeries({ color: x.col, lineWidth: 2, priceLineVisible: false, lineType: x.l === "OPR" ? 1 : 0, priceFormat: { type: "price", precision: prec, minMove: Math.pow(10, -prec) } }); s.setData(x.data.map(([time, value]) => ({ time, value }))); sers.push(s); });
    ch.timeScale().fitContent();
    legFn = (t) => { $("mmLeg").innerHTML = lines.map((x) => { const v = t ? x.data.find(([d]) => d === t) : x.data.at(-1); return `<span><i style="background:${x.col};height:2.5px"></i>${esc(x.l)} <b>${v ? fmtV(mode, v[1]) : "–"}</b></span>`; }).join("") + `<span class="mut">${esc(t || lines[0]?.data.at(-1)?.[0] || "")}</span>`; };
    legFn(null);
    const short = lines.filter((x) => x.data.length < 20).length;
    $("mmNote").textContent = {
      rates: "OPR from Bank Negara Malaysia's Monetary Policy Committee decisions (a step line). T-bill ~1M is FAST's shortest Malaysian Treasury bill band; MGS 3Y is a point on the FAST MGS curve; Corp AAA 3Y is FAST's AAA corporate curve.",
      money: "How far the government curve sits above the policy rate. Bills trade close to the OPR and BNM's liquidity operations; a wide 3Y − OPR gap means the market is pricing hikes or a term premium.",
      gii: "GII (Islamic government sukuk) over MGS of the same tenor, from the two FAST curves. GII usually yield a few bp more than MGS, a liquidity premium; the gap narrows when Islamic banks and funds are flush and widens when GII supply is heavy.",
      credit: "FAST's corporate curves by rating over the MGS curve at 3 years. AAA is the investment-grade benchmark; BBB over AA is the high-yield premium. Spreads widening while MGS rally usually means risk-off.",
      fx: "Bank Negara Malaysia's KL USD/MYR reference rate (volume-weighted interbank spot, published 3:30 pm); before the dashboard's first stored day, Yahoo's USD/MYR close. A weaker ringgit (line up) has gone with foreign selling of MGS.",
    }[mode] + (short ? " Lines from FAST start on the earliest day the dashboard has back-filled and lengthen as more history is stored." : "");
  }
  function table(d) {
    const R = [["OPR", "opr"], ["T-bill ~1M (FAST band 1)", "mtb1"], ["T-bill ~1Y (FAST band 10)", "mtb10"], ["MGS 1Y", "mgs1"], ["MGS 3Y", "mgs3"], ["MGS 5Y", "mgs5"], ["MGS 10Y", "mgs10"], ["GII 3Y", "gii3"], ["GII 10Y", "gii10"], ["Corp AAA 3Y", "aaa3"], ["Corp AAA 5Y", "aaa5"], ["Corp AAA 10Y", "aaa10"], ["Corp AA1 3Y", "aa13"], ["Corp AA 3Y", "aa3"], ["Corp AA 5Y", "aa5"], ["Corp A 3Y", "a3"], ["Corp BBB 3Y", "bbb3"]].filter(([, k]) => S[k]?.length);
    $("mmTab").innerHTML = R.map(([l, k]) => {
      const s = S[k], last = s.at(-1)[1], dd = (x) => x == null ? null : (last - x) * 100, y1 = s.length > 200 ? back(s, 365) : null, ys = s.filter(([dt]) => dt >= new Date(Date.parse(s.at(-1)[0]) - 366 * 864e5).toISOString().slice(0, 10)).map((x) => x[1]);
      return `<tr><td>${esc(l)}</td><td><b>${last.toFixed(3)}</b></td><td class="${cls(dd(s.at(-2)?.[1]))}">${sgn(dd(s.at(-2)?.[1]))}</td><td class="${cls(dd(back(s, 7)))}">${sgn(dd(back(s, 7)))}</td><td class="${cls(dd(back(s, 30)))}">${sgn(dd(back(s, 30)))}</td><td class="${cls(dd(y1))}">${sgn(dd(y1))}</td><td>${Math.min(...ys).toFixed(3)} – ${Math.max(...ys).toFixed(3)}${s.length < 200 ? ` <small class="mut">(since ${esc(s[0][0])})</small>` : ""}</td></tr>`;
    }).join("");
    const bd = (d.oprDecisions || []).slice(-6).reverse().map(([dt, v]) => `${dt} ${v.toFixed(2)}%`).join(" · ");
    if (bd && $("mmDec")) $("mmDec").textContent = `OPR changes, latest first: ${bd}.`;
  }
})();
