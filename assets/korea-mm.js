/* Korea tab: "Funding and credit". Korea publishes no bond lending fee (bond borrowing is bilateral through KSD and
   brokers), so the funding section tracks what is public and moves KTBs: KOFIA's CD 91-day, CP 91-day and MSB
   91-day final quotes, plus credit spreads (KDB 1Y, KEPCO 3Y, corporate AA- and BBB- 3Y over the 3Y KTB).
   Data: data/korea.json → mm.series (scripts/fetch-korea.mjs). */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("mmTiles") || !window.LightweightCharts) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const sgn = (v, d = 1) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const cls = (v) => v == null || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down";
  const RNG = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366 };
  // [key, label, series or [a, b] spread (b − a, bp), colour]
  const LINES = {
    rates: [["cd", "CD 91d", "cd", "--c1"], ["cp", "CP 91d", "cp", "--c2"], ["msb91", "MSB 91d", "msb91", "--c4"], ["kdb1y", "KDB 1Y", "kdb1y", "--c3"]],
    money: [["cpcd", "CP − CD", ["cd", "cp"], "--c2"], ["cdmsb", "CD − MSB 91d", ["msb91", "cd"], "--c1"], ["kdbmsb", "KDB 1Y − MSB 91d", ["msb91", "kdb1y"], "--c3"]],
    credit: [["aa", "Corp AA- 3Y − KTB 3Y", ["ktb3y", "aa3y"], "--c1"], ["bbb", "Corp BBB- − AA- 3Y", ["aa3y", "bbb3y"], "--c5"], ["kepco", "KEPCO 3Y − KTB 3Y", ["ktb3y", "kepco3y"], "--c2"]],
  };
  const st = { mode: "rates", rng: "6M" };
  let S, ch, sers = [], legFn = null;
  const opts = () => ({ autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 }, localization: { locale: "en-US" } });
  const serOf = (spec) => {
    if (typeof spec === "string") return S[spec] || [];
    const A = new Map(S[spec[0]] || []); return (S[spec[1]] || []).filter(([d]) => A.has(d)).map(([d, y]) => [d, +((y - A.get(d)) * 100).toFixed(1)]);
  };
  const back = (s, days) => { const c = new Date(Date.parse(s.at(-1)[0]) - days * 864e5).toISOString().slice(0, 10); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= c) return s[i][1]; return null; };

  fetch("../data/korea.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d?.mm?.series) return;
    S = d.mm.series; tiles(); draw(); table();
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
  });
  function tiles() {
    const T = [["cd", "CD 91d", "cd"], ["cp", "CP 91d", "cp"], ["msb91", "MSB 91d", "msb91"], ["kdb1y", "KDB 1Y", "kdb1y"], ["aa", "AA- 3Y spread", ["ktb3y", "aa3y"]], ["bbb", "BBB- vs AA-", ["aa3y", "bbb3y"]]];
    $("mmTiles").innerHTML = T.map(([k, l, spec]) => {
      const s = serOf(spec); if (!s.length) return "";
      const sp = typeof spec !== "string", last = s.at(-1)[1], d1 = s.length > 1 ? last - s.at(-2)[1] : null, w = back(s, 7), m = back(s, 30);
      const f = (x) => x == null ? null : sp ? last - x : (last - x) * 100;
      return `<div class="tile"><b>${esc(l)}</b><span class="v">${sp ? sgn(last) + " bp" : last.toFixed(3) + "%"}</span><span class="c ${cls(f(s.at(-2)?.[1]))}">${sgn(sp ? d1 : d1 * 100)} bp 1D</span><small>1W ${sgn(f(w))} · 1M ${sgn(f(m))} bp</small></div>`;
    }).join("");
  }
  function draw() {
    const b = (id, list, key) => { $(id).innerHTML = list.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${st[key] === k}">${l}</button>`).join(""); $(id).querySelectorAll("button").forEach((x) => x.onclick = () => { st[key] = x.dataset.k; draw(); }); };
    b("mmMode", [["rates", "Money-market rates"], ["money", "Funding spreads"], ["credit", "Credit spreads"]], "mode");
    b("mmRng", Object.keys(RNG).map((r) => [r, r]), "rng");
    if (!ch) { ch = LightweightCharts.createChart($("mmChart"), opts()); ch.subscribeCrosshairMove((q) => legFn && legFn(q?.time || null)); } else ch.applyOptions(opts());
    sers.forEach((s) => ch.removeSeries(s)); sers = [];
    const sp = st.mode !== "rates";
    const lines = LINES[st.mode].map(([k, l, spec, c]) => { const s = serOf(spec); const cut = s.length ? new Date(Date.parse(s.at(-1)[0]) - RNG[st.rng] * 864e5).toISOString().slice(0, 10) : ""; return { l, col: css(c), data: s.filter(([d]) => d >= cut) }; });
    lines.forEach((x) => { const s = ch.addLineSeries({ color: x.col, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: sp ? 1 : 3, minMove: sp ? 0.1 : 0.001 } }); s.setData(x.data.map(([time, value]) => ({ time, value }))); sers.push(s); });
    ch.timeScale().fitContent();
    legFn = (t) => { $("mmLeg").innerHTML = lines.map((x) => { const v = t ? x.data.find(([d]) => d === t) : x.data.at(-1); return `<span><i style="background:${x.col};height:2.5px"></i>${esc(x.l)} <b>${v ? (sp ? sgn(v[1]) + " bp" : v[1].toFixed(3) + "%") : "–"}</b></span>`; }).join("") + `<span class="mut">${esc(t || lines[0]?.data.at(-1)?.[0] || "")}</span>`; };
    legFn(null);
    $("mmNote").textContent = { rates: "KOFIA final quotes. CD 91-day is the benchmark for floating-rate loans and interest-rate swaps; MSB 91-day is the Bank of Korea's own bill rate and tracks the policy rate most closely.", money: "Funding stress gauges: CP over CD widens when companies struggle to roll short-term paper (it spiked in the 2022 Legoland episode); CD over MSB is the bank funding premium.", credit: "KOFIA 3-year credit curves over the 3-year KTB. AA- is the investment-grade benchmark; BBB- over AA- is the high-yield premium. Wider spreads with falling KTB yields usually mean risk-off." }[st.mode];
  }
  function table() {
    const R = [["CD 91-day", "cd"], ["CP 91-day", "cp"], ["MSB 91-day", "msb91"], ["MSB 1Y vs KTB 1Y", null], ["KDB 1Y", "kdb1y"], ["KEPCO 3Y", "kepco3y"], ["Corp AA- 3Y", "aa3y"], ["Corp BBB- 3Y", "bbb3y"], ["KTB 3Y", "ktb3y"]].filter(([, k]) => k && S[k]?.length);
    $("mmTab").innerHTML = R.map(([l, k]) => {
      const s = S[k], last = s.at(-1)[1], d = (x) => x == null ? null : (last - x) * 100, y1 = back(s, 365), ys = s.map((x) => x[1]);
      return `<tr><td>${esc(l)}</td><td><b>${last.toFixed(3)}</b></td><td class="${cls(d(s.at(-2)?.[1]))}">${sgn(d(s.at(-2)?.[1]))}</td><td class="${cls(d(back(s, 7)))}">${sgn(d(back(s, 7)))}</td><td class="${cls(d(back(s, 30)))}">${sgn(d(back(s, 30)))}</td><td class="${cls(d(y1))}">${sgn(d(y1))}</td><td>${Math.min(...ys).toFixed(3)} – ${Math.max(...ys).toFixed(3)}</td></tr>`;
    }).join("");
  }
})();
