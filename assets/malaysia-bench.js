/* Malaysia tab: "Benchmarks and relative value" (takes the place of the China / Korea futures sections: Bursa
   Malaysia's MGS futures trade too thinly to chart). Shows Bank Negara Malaysia's 3/5/7/10-year MGS and GII benchmark
   closes, every MGS and GII's spread to its FAST curve (rich / cheap), and benchmark yield history.
   Data: data/malaysia.json → benchmarks, bonds, benchHist (scripts/fetch-malaysia.mjs). */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("bmTiles")) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const f = (v, n = 3) => v == null || !isFinite(v) ? "–" : (+v).toFixed(n);
  const sgn = (v, d = 1) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const cls = (v) => v == null || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down";
  const FAM = { MGS: "--c1", GII: "--c4" };
  const fam = (b) => b.iss === "GII" ? "GII" : "MGS";
  const key = (b) => `${b.iss} ${b.tenor}Y`;
  let D = null, ch = null, sers = [], pick = new Set();
  const st = { fams: new Set(["MGS", "GII"]) };

  fetch("../data/malaysia.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d?.benchmarks) { $("bmStamp").textContent = "Benchmark data is not available yet."; return; }
    D = d;
    const bm = [...(d.benchmarks.mgs || []), ...(d.benchmarks.gii || [])];
    pick = new Set(bm.filter((b) => b.iss === "MGS").map(key));
    $("bmStamp").innerHTML = `<b>BNM benchmark closes for ${esc(d.benchmarks.date || d.tradeDay || "–")}</b><br>${bm.length} benchmarks (3, 5, 7 and 10-year MGS and GII on the ETP) · ${(d.bonds || []).filter((b) => b.last != null).length} MGS and GII with a yield in all`;
    tiles(bm); table(bm); rv(); hist();
    addEventListener("resize", () => { clearTimeout(rv.t); rv.t = setTimeout(rv, 120); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { rv(); hist(); });
  });

  function tiles(bm) {
    $("bmTiles").innerHTML = bm.map((b) => `<button class="tile" type="button" data-k="${esc(key(b))}" aria-pressed="${pick.has(key(b))}"><b>${esc(key(b))}${b.stale ? " *" : ""}</b><span class="v">${f(b.last, 2)}%</span><span class="c ${cls(b.chg)}">${sgn(b.chg, 0)} bp 1D</span><small>vs curve ${sgn(b.vs)} bp · ${esc(b.code)}</small></button>`).join("");
    $("bmTiles").querySelectorAll(".tile").forEach((t) => t.onclick = () => { const k = t.dataset.k; pick.has(k) ? pick.delete(k) : pick.add(k); if (!pick.size) pick.add(k); t.setAttribute("aria-pressed", pick.has(k)); hist(); });
  }
  function table(bm) {
    $("bmTab").innerHTML = bm.map((b) => `<tr><td class="code">${esc(key(b))}${b.stale ? " *" : ""}</td><td>${esc(b.code)}<br><small class="mut">${esc(b.isin || "–")}</small></td><td>${esc(b.mat || b.matTxt || "–")}</td><td>${f(b.ttm, 2)}</td><td>${f(b.coupon, 3)}</td><td><b>${f(b.last, 2)}</b></td><td>${f(b.px, 3)}</td><td class="${cls(b.chg)}">${sgn(b.chg, 0)}</td><td>${b.vol != null ? f(b.vol, 1) : "–"}</td><td>${f(b.curve, 3)}</td><td class="${cls(b.vs)}">${sgn(b.vs)}</td></tr>`).join("");
    $("bmTabNote").textContent = "Close is the benchmark's closing traded yield on Bursa Malaysia Bonds' ETP as published by Bank Negara Malaysia (2 decimals; * = last traded, no trade on the day). \"Curve\" is the FAST consolidated indicative curve (MGS or GII) at the benchmark's remaining term, and \"vs curve\" the close minus the curve: positive means the benchmark trades cheap to the dealer curve, negative rich. On-the-run benchmarks usually trade a little rich because they are the most liquid stocks.";
  }

  // relative value: every MGS and GII's spread to its curve, by remaining term
  function rv() {
    const svg = $("bmRv"); if (!svg || !D) return;
    $("bmFam").innerHTML = Object.keys(FAM).filter((k) => (D.bonds || []).some((b) => b.vs != null && fam(b) === k)).map((k) => `<button type="button" data-k="${k}" aria-pressed="${st.fams.has(k)}"><i class="hsw" style="background:var(${FAM[k]})"></i>${k}</button>`).join("");
    $("bmFam").querySelectorAll("button").forEach((b) => b.onclick = () => { const k = b.dataset.k; st.fams.has(k) ? st.fams.delete(k) : st.fams.add(k); rv(); });
    const pts = (D.bonds || []).filter((b) => b.vs != null && b.ttm >= 1 && st.fams.has(fam(b))).map((b) => ({ ...b, s: b.vs }));
    const W = Math.max(300, svg.clientWidth || 600), H = 280, P = { l: 44, r: 12, t: 12, b: 28 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (!pts.length) { svg.innerHTML = ""; return; }
    const xmax = Math.max(5, Math.ceil(Math.max(...pts.map((p) => p.ttm)))), lo = Math.min(-10, ...pts.map((p) => p.s)) - 3, hi = Math.max(10, ...pts.map((p) => p.s)) + 3;
    const X = (t) => P.l + t / xmax * (W - P.l - P.r), Y = (v) => P.t + (hi - v) / (hi - lo) * (H - P.t - P.b);
    let g = "";
    const step = hi - lo > 120 ? 25 : hi - lo > 50 ? 10 : 5;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" ${v === 0 ? 'stroke-width="1.5" stroke="var(--muted)"' : ""}/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${v > 0 ? "+" : ""}${v}</text>`;
    for (let t = 0; t <= xmax; t += xmax > 15 ? 5 : xmax > 6 ? 2 : 1) g += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t}Y</text>`;
    g += `<text x="${W - P.r}" y="${Y(hi) + 12}" text-anchor="end" font-size="11" fill="var(--muted)">cheap ↑</text><text x="${W - P.r}" y="${Y(lo) - 4}" text-anchor="end" font-size="11" fill="var(--muted)">rich ↓</text>`;
    g += pts.map((p) => `<circle cx="${X(p.ttm).toFixed(1)}" cy="${Y(p.s).toFixed(1)}" r="5" fill="var(${FAM[fam(p)]})" fill-opacity=".85" stroke="var(--panel)"><title>${esc(p.code)} · ${esc(p.name || "")} · ${esc(p.isin || "")} · ${f(p.ttm, 2)}Y · ${f(p.last, 3)}% · curve ${f(p.curve, 3)}% · ${sgn(p.s)} bp</title></circle>`).join("");
    const top = [...pts].sort((a, b) => Math.abs(b.s) - Math.abs(a.s)).slice(0, 4);
    g += top.map((p) => `<text x="${X(p.ttm) + 7}" y="${Y(p.s) + 4}" font-size="10.5" fill="var(--ink)" font-family="var(--f-mono)">${esc(p.name || p.code)}</text>`).join("");
    svg.innerHTML = g;
    const by = (k) => { const s = pts.filter((p) => fam(p) === k).map((p) => p.s); return s.length ? `${k} ${sgn(s.reduce((a, b) => a + b, 0) / s.length)} bp (${s.length})` : null; };
    $("bmRvNote").textContent = `Each dot is an MGS at its FAST indicative yield, or a GII at its ETP close, on ${D.tradeDay || "the latest day"}, minus its curve at the same remaining term (MGS: FAST MGS curve; GII: FAST GII curve). Average by type: ${["MGS", "GII"].map(by).filter(Boolean).join(" · ")}. Old high-coupon MGS often sit a little cheap to the curve, and fresh benchmarks a little rich; a stock far off the curve may be an old issue that rarely trades. Bonds under one year are left out.`;
  }

  // benchmark yield history (BNM's daily closes, stored by the dashboard from its first day)
  function hist() {
    if (!window.LightweightCharts) return;
    if (!D?.benchHist || !Object.keys(D.benchHist).length) { $("bmHist").style.height = "0"; $("bmHNote").textContent = "Benchmark history starts with the next update."; return; }
    $("bmHist").style.height = "300px";
    const opts = { autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 } };
    if (!ch) ch = LightweightCharts.createChart($("bmHist"), opts); else ch.applyOptions(opts);
    sers.forEach((s) => ch.removeSeries(s)); sers = [];
    const cols = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c1", "--c2"];
    // BNM's benchmark closes are stored from the dashboard's first day; before that the FAST curve at the same tenor stands in
    const lines = [...pick].map((k, i) => {
      const [iss, ten] = k.split(" "), t = parseInt(ten, 10);
      const own = (D.benchHist[k] || []).filter((r) => r[1] != null).map((r) => [r[0], r[1]]);
      const curve = (iss === "GII" ? D.pb?.gii?.tenors?.[t] : D.tenors?.[t]) || [];
      const first = own[0]?.[0] || "9999";
      return { k, col: css(cols[i % cols.length]), data: [...curve.filter(([d]) => d < first), ...own] };
    }).filter((x) => x.data.length);
    lines.forEach((x, i) => { const s = ch.addLineSeries({ color: x.col, lineWidth: 2, lineStyle: x.k.startsWith("GII") ? 2 : 0, priceLineVisible: false, priceFormat: { type: "price", precision: 3, minMove: 0.001 } }); s.setData(x.data.map((r) => ({ time: r[0], value: r[1] }))); sers.push(s); });
    ch.timeScale().fitContent();
    const days = Math.max(0, ...[...pick].map((k) => (D.benchHist[k] || []).length));
    $("bmHLeg").innerHTML = lines.map((x) => `<span><i style="background:${x.col};height:2.5px"></i>${esc(x.k)} <b>${f(x.data.at(-1)[1], 3)}%</b></span>`).join("");
    $("bmHNote").textContent = `Yields of the selected benchmarks (click the tiles above to add or remove one; GII dashed). BNM's benchmark closes are stored from the dashboard's first day (${days} day${days === 1 ? "" : "s"} so far); before that each line shows the FAST curve at the same tenor, which tracks the benchmark within a few bp.`;
  }
})();
