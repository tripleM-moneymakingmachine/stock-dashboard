/* Korea tab: "KTB futures". The 3Y, 5Y, 10Y and 30Y KTB futures on KRX, valued at each KOFIA close from the
   delivery basket (KRX settles on the basket's average yield through a 5% coupon notional bond).
   Data: data/ktb-futures.json (scripts/fetch-ktb-futures.mjs); cash benchmarks from data/korea.json. */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("kfTiles") || !window.LightweightCharts) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const sgn = (v, d = 1, u = "") => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + u;
  const cls = (v) => v == null || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down";
  const COL = { "3Y": "--c1", "5Y": "--c2", "10Y": "--c4", "30Y": "--c5" };
  const TEN = { "3Y": 3, "5Y": 5, "10Y": 10, "30Y": 30 };
  const RNG = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366 };
  const st = { p: "10Y", rng: "6M", yr: "6M", ymode: "lvl", on: { "3Y": true, "5Y": true, "10Y": true, "30Y": true } };
  let F, K, pc, pser, yc, yser = [], pLeg = null, yLeg = null;
  const opts = () => ({ autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 }, localization: { locale: "en-US" } });
  const cut = (h, r) => { if (!h.length) return h; const c = new Date(Date.parse(h.at(-1)[0]) - RNG[r] * 864e5).toISOString().slice(0, 10); return h.filter(([d]) => d >= c); };
  const prod = (p) => F.products.find((x) => x.p === p);
  const btns = (id, list, key, cb) => { $(id).innerHTML = list.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${st[key] === k}">${l}</button>`).join(""); $(id).querySelectorAll("button").forEach((b) => b.onclick = () => { st[key] = b.dataset.k; cb(); }); };

  Promise.all(["../data/ktb-futures.json", "../data/korea.json"].map((u) => fetch(u + "?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null))).then(([f, k]) => {
    if (!f?.products?.length) { $("kfStamp").textContent = "KTB futures data is not available yet; it is rebuilt after each KOFIA close."; return; }
    F = f; K = k; all();
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", all);
  });
  function all() { stamp(); tiles(); price(); table(); yields(); }

  function stamp() {
    const fr = F.front;
    $("kfStamp").innerHTML = `<b>Fair value at the KOFIA close, ${esc(F.settleDate)}</b> · front contract ${esc(fr?.month || "–")} (last trading day ${esc(fr?.ltd || "–")}) · computed from each contract's delivery basket, not an exchange quote`;
  }
  function tiles() {
    $("kfTiles").innerHTML = F.products.map((p) => `<button class="tile" type="button" data-k="${p.p}" aria-pressed="${p.p === st.p}"><b>KTB ${p.p} futures</b><span class="v">${p.fair?.toFixed(2) ?? "–"}</span><span class="c ${cls(p.chgPts)}">${sgn(p.chgPts, 2)} pts 1D</span><small>Implied ${p.yld?.toFixed(3) ?? "–"}% · ${sgn(p.chgBp)} bp · 1W ${sgn(p.wkBp)} · 1M ${sgn(p.moBp)} bp</small></button>`).join("");
    $("kfTiles").querySelectorAll(".tile").forEach((b) => b.onclick = () => { st.p = b.dataset.k; tiles(); price(); table(); });
  }
  function price() {
    const p = prod(st.p), h = cut(p.hist, st.rng);
    btns("kfRng", Object.keys(RNG).map((r) => [r, r]), "rng", price);
    btns("kfProd", F.products.map((x) => [x.p, x.p]), "p", () => { tiles(); price(); table(); });
    $("kfPH").textContent = `KTB ${p.p} futures fair value (points)`;
    if (!pc) { pc = LightweightCharts.createChart($("kfChart"), opts()); pc.subscribeCrosshairMove((q) => pLeg && pLeg(q)); } else pc.applyOptions(opts());
    if (pser) pc.removeSeries(pser);
    pser = pc.addAreaSeries({ lineColor: css(COL[p.p]), topColor: css(COL[p.p]) + "33", bottomColor: "transparent", lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    pser.setData(h.map(([time, value]) => ({ time, value })));
    pc.timeScale().fitContent();
    const leg = (r) => { if (!r) return; $("kfLeg").innerHTML = `<span><i style="background:${css(COL[p.p])};height:2.5px"></i>KTB ${p.p} <b>${r[1].toFixed(2)}</b></span><span>implied yield <b>${r[2].toFixed(3)}%</b></span><span class="mut">${esc(r[0])}</span>`; };
    pLeg = (q) => leg(q?.time ? p.hist.find((x) => x[0] === q.time) : h.at(-1)); leg(h.at(-1));
    const ys = h.map((x) => x[1]), lo = Math.min(...ys), hi = Math.max(...ys);
    $("kfStats").innerHTML = [["Fair value", p.fair?.toFixed(2)], [`${st.rng} change`, `<span class="${cls(h.at(-1)[1] - h[0][1])}">${sgn(h.at(-1)[1] - h[0][1], 2)} pts</span>`], ["High", hi.toFixed(2)], ["Low", lo.toFixed(2)], ["DV01 / contract", `KRW ${(p.dv01Krw / 1000).toFixed(0)}k`]].map(([a, b]) => `<div>${a}<span>${b}</span></div>`).join("");
    $("kfPNote").textContent = `KRX lists KTB futures as a notional ${p.term}-year bond with a 5% semi-annual coupon, KRW 100m face, KRW 1m per point. At expiry they settle in cash at the price of that notional bond discounted at the simple average of the delivery basket's KOFIA yields, so the basket average is the contract's fair implied yield and this line is that price at each KOFIA close. A traded futures price sits a few ticks away from it (carry and basis); live exchange quotes need a KRX market-data key. DV01 is the KRW change in one contract's value for a 1bp move.`;
  }
  function table() {
    const p = prod(st.p), cash = (t) => { const s = K?.tenors?.[t]; return s?.length ? s.at(-1)[1] : null; };
    $("kfTH").textContent = `KTB ${p.p} delivery basket (KOFIA, ${F.settleDate})`;
    $("kfTab").innerHTML = p.basket.map((b) => `<tr><td class="nm">${esc(b.name)}</td><td>${esc(b.isin)}</td><td>${esc(b.mat.slice(0, 7))}</td><td>${b.ttm.toFixed(2)}</td><td>${b.am?.toFixed(3) ?? "–"}</td><td><b>${b.y.toFixed(3)}</b></td></tr>`).join("") +
      `<tr class="g"><td colspan="5">Basket average = implied yield</td><td><b>${p.yld.toFixed(3)}</b></td></tr>`;
    const c = cash(TEN[p.p]);
    $("kfTabNote").textContent = `Morning and close are KOFIA's 11:30 and 15:30 final quotes for each basket bond. The ${p.p} benchmark KTB closed at ${c?.toFixed(3) ?? "–"}%, so the futures' implied yield is ${sgn(c != null ? (p.yld - c) * 100 : null)} bp against the cash benchmark (the basket bonds are slightly shorter or longer than the benchmark).`;
  }
  function yields() {
    btns("kfYRng", Object.keys(RNG).map((r) => [r, r]), "yr", yields);
    btns("kfYMode", [["lvl", "Implied yields"], ["cur", "Curve spreads"]], "ymode", yields);
    $("kfYTen").innerHTML = F.products.map((p) => `<button type="button" data-k="${p.p}" aria-pressed="${!!st.on[p.p]}"><i style="background:${css(COL[p.p])}"></i>${p.p}</button>`).join("");
    $("kfYTen").querySelectorAll("button").forEach((b) => b.onclick = () => { st.on[b.dataset.k] = !st.on[b.dataset.k]; yields(); });
    $("kfYTen").style.display = st.ymode === "lvl" ? "" : "none";
    if (!yc) { yc = LightweightCharts.createChart($("kfYChart"), opts()); yc.subscribeCrosshairMove((q) => yLeg && yLeg(q)); } else yc.applyOptions(opts());
    yser.forEach((s) => yc.removeSeries(s)); yser = [];
    let lines;
    if (st.ymode === "lvl") lines = F.products.filter((p) => st.on[p.p]).map((p) => ({ name: `KTB ${p.p} implied`, col: css(COL[p.p]), data: cut(p.hist, st.yr).map(([d, , y]) => [d, y]), u: "%" }));
    else {
      const m = (p) => new Map(prod(p).hist.map(([d, , y]) => [d, y]));
      const sp = (a, b) => { const A = m(a), B = m(b); return cut([...B.keys()].filter((d) => A.has(d)).sort().map((d) => [d, +((B.get(d) - A.get(d)) * 100).toFixed(1)]), st.yr); };
      lines = [{ name: "3s10s (10Y − 3Y)", col: css("--c1"), data: sp("3Y", "10Y"), u: "bp" }, { name: "10s30s (30Y − 10Y)", col: css("--c5"), data: sp("10Y", "30Y"), u: "bp" }, { name: "3s5s (5Y − 3Y)", col: css("--c2"), data: sp("3Y", "5Y"), u: "bp" }];
    }
    lines.forEach((l) => { const s = yc.addLineSeries({ color: l.col, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: l.u === "%" ? 3 : 1, minMove: l.u === "%" ? 0.001 : 0.1 } }); s.setData(l.data.map(([time, value]) => ({ time, value }))); yser.push(s); });
    yc.timeScale().fitContent();
    const leg = (t) => { $("kfYLeg").innerHTML = lines.map((l) => { const v = t ? l.data.find(([d]) => d === t) : l.data.at(-1); return `<span><i style="background:${l.col};height:2.5px"></i>${esc(l.name)} <b>${v ? (l.u === "%" ? v[1].toFixed(3) + "%" : sgn(v[1]) + " bp") : "–"}</b></span>`; }).join("") + `<span class="mut">${esc(t || lines[0]?.data.at(-1)?.[0] || "")}</span>`; };
    yLeg = (q) => leg(q?.time || null); leg(null);
    $("kfYNote").textContent = st.ymode === "lvl" ? "Each line is a contract's basket-average yield at the KOFIA close: the yield the futures price implies. Click a tenor to show or hide it." : "Curve trades in futures: the spread between two contracts' implied yields. A rising line is a steepener. KRX lists 3Y/10Y and 10Y/30Y as the standard curve spreads.";
  }
})();
