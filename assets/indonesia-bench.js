/* Indonesia tab: "Benchmark series and relative value" (takes the place of the China / Korea futures sections:
   Indonesia has no liquid listed government bond futures). Shows PHEI's benchmark FR and PBS series with fair yield
   and price, every PHEI-priced bond's spread to the IGSYC curve (rich / cheap), and benchmark yield history.
   Data: data/indonesia.json → benchmarks, bonds, benchHist, curve (scripts/fetch-indonesia.mjs). */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("bmTiles")) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const f = (v, n = 3) => v == null || !isFinite(v) ? "–" : (+v).toFixed(n);
  const sgn = (v, d = 1) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const cls = (v) => v == null || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down";
  const FAM = { FR: "--c1", PBS: "--c4", ORI: "--c2", SR: "--c5", IFR: "--c3", Other: "--c6" };
  const fam = (code) => (code.match(/^(FR|PBS|ORI|SR|IFR)/) || [, "Other"])[1];
  let D = null, igs = null, ch = null, sers = [], pick = new Set();
  const st = { fams: new Set(["FR", "PBS", "ORI", "SR"]) };

  function curveFn(pts) {
    return (t) => { if (!pts?.length) return null; if (t <= pts[0][0]) return pts[0][1]; for (let i = 0; i < pts.length - 1; i++) if (t <= pts[i + 1][0]) { const [a, y0] = pts[i], [b, y1] = pts[i + 1]; return y0 + (y1 - y0) * (t - a) / (b - a); } return pts.at(-1)[1]; };
  }
  fetch("../data/indonesia.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d?.benchmarks) { $("bmStamp").textContent = "Benchmark data is not available yet."; return; }
    D = d; igs = curveFn(d.curve?.pts);
    const bm = [...(d.benchmarks.fr || []), ...(d.benchmarks.pbs || [])];
    pick = new Set(bm.map((b) => b.code));
    $("bmStamp").innerHTML = `<b>PHEI fair values for ${esc(d.benchmarks.date || d.tradeDay || "–")}</b><br>${bm.length} benchmark series (the FR and PBS series PHEI and the Ministry of Finance treat as on-the-run) · ${(d.bonds || []).filter((b) => b.last != null).length} PHEI-priced bonds in all`;
    tiles(bm); table(bm); rv(); hist();
    addEventListener("resize", () => { clearTimeout(rv.t); rv.t = setTimeout(rv, 120); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { rv(); hist(); });
  });

  function tiles(bm) {
    $("bmTiles").innerHTML = bm.map((b) => {
      const c = igs(b.ttm), vs = b.last != null && c != null ? (b.last - c) * 100 : null;
      return `<button class="tile" type="button" data-k="${esc(b.code)}" aria-pressed="${pick.has(b.code)}"><b>${esc(b.code)} · ${f(b.ttm, 1)}Y</b><span class="v">${f(b.last, 3)}%</span><span class="c ${cls(b.chg)}">${sgn(b.chg)} bp 1D</span><small>vs IGSYC ${sgn(vs)} bp</small></button>`;
    }).join("");
    $("bmTiles").querySelectorAll(".tile").forEach((t) => t.onclick = () => { const k = t.dataset.k; pick.has(k) ? pick.delete(k) : pick.add(k); if (!pick.size) pick.add(k); t.setAttribute("aria-pressed", pick.has(k)); hist(); });
  }
  function table(bm) {
    $("bmTab").innerHTML = bm.map((b) => {
      const c = igs(b.ttm), vs = b.last != null && c != null ? (b.last - c) * 100 : null;
      return `<tr><td class="code">${esc(b.code)}</td><td>${esc(b.isin || "–")}</td><td>${esc(b.mat || "–")}${b.est ? " <small class=\"mut\">(est.)</small>" : ""}</td><td>${f(b.ttm, 2)}</td><td>${f(b.coupon, 3)}</td><td><b>${f(b.last, 4)}</b></td><td>${f(b.px, 4)}</td><td class="${cls(b.chg)}">${sgn(b.chg)}</td><td>${f(c, 4)}</td><td class="${cls(vs)}">${sgn(vs)}</td></tr>`;
    }).join("");
    $("bmTabNote").textContent = "Fair yield and price are PHEI's end-of-day valuations (PHEI's \"Harga Pasar Wajar\"). \"vs IGSYC\" is the series' fair yield minus the IGSYC curve at its remaining term: positive means the bond yields more than the curve (cheap), negative means it is rich. PBS sukuk usually price a little through or around IGSYC because Islamic funds and banks must hold them.";
  }

  // relative value: every PHEI-priced bond's spread to IGSYC, by remaining term
  function rv() {
    const svg = $("bmRv"); if (!svg || !D) return;
    $("bmFam").innerHTML = Object.keys(FAM).filter((k) => k !== "Other" && (D.bonds || []).some((b) => b.last != null && fam(b.code) === k)).map((k) => `<button type="button" data-k="${k}" aria-pressed="${st.fams.has(k)}"><i class="hsw" style="background:var(${FAM[k]})"></i>${k}</button>`).join("");
    $("bmFam").querySelectorAll("button").forEach((b) => b.onclick = () => { const k = b.dataset.k; st.fams.has(k) ? st.fams.delete(k) : st.fams.add(k); rv(); });
    const pts = (D.bonds || []).filter((b) => b.last != null && b.ttm > 0 && st.fams.has(fam(b.code))).map((b) => ({ ...b, s: (b.last - igs(b.ttm)) * 100 }));
    const W = Math.max(300, svg.clientWidth || 600), H = 280, P = { l: 44, r: 12, t: 12, b: 28 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (!pts.length) { svg.innerHTML = ""; return; }
    const xmax = Math.max(5, Math.ceil(Math.max(...pts.map((p) => p.ttm)))), lo = Math.min(-10, ...pts.map((p) => p.s)) - 5, hi = Math.max(10, ...pts.map((p) => p.s)) + 5;
    const X = (t) => P.l + t / xmax * (W - P.l - P.r), Y = (v) => P.t + (hi - v) / (hi - lo) * (H - P.t - P.b);
    let g = "";
    const step = hi - lo > 120 ? 25 : hi - lo > 50 ? 10 : 5;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" ${v === 0 ? 'stroke-width="1.5" stroke="var(--muted)"' : ""}/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${v > 0 ? "+" : ""}${v}</text>`;
    for (let t = 0; t <= xmax; t += xmax > 15 ? 5 : xmax > 6 ? 2 : 1) g += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t}Y</text>`;
    g += `<text x="${W - P.r}" y="${Y(hi) + 12}" text-anchor="end" font-size="11" fill="var(--muted)">cheap ↑</text><text x="${W - P.r}" y="${Y(lo) - 4}" text-anchor="end" font-size="11" fill="var(--muted)">rich ↓</text>`;
    g += pts.map((p) => `<circle cx="${X(p.ttm).toFixed(1)}" cy="${Y(p.s).toFixed(1)}" r="5" fill="var(${FAM[fam(p.code)]})" fill-opacity=".85" stroke="var(--panel)"><title>${esc(p.code)}${p.isin ? " · " + esc(p.isin) : ""} · ${f(p.ttm, 2)}Y · PHEI ${f(p.last, 3)}% · IGSYC ${f(igs(p.ttm), 3)}% · ${sgn(p.s)} bp</title></circle>`).join("");
    const top = [...pts].sort((a, b) => Math.abs(b.s) - Math.abs(a.s)).slice(0, 4);
    g += top.map((p) => `<text x="${X(p.ttm) + 7}" y="${Y(p.s) + 4}" font-size="10.5" fill="var(--ink)" font-family="var(--f-mono)">${esc(p.code)}</text>`).join("");
    svg.innerHTML = g;
    const by = (k) => { const s = pts.filter((p) => fam(p.code) === k).map((p) => p.s); return s.length ? `${k} ${sgn(s.reduce((a, b) => a + b, 0) / s.length)} bp (${s.length})` : null; };
    $("bmRvNote").textContent = `Each dot is a bond PHEI priced on ${D.tradeDay || "the latest day"}: its fair yield minus IGSYC at the same remaining term. Average by family: ${["FR", "PBS", "ORI", "SR"].map(by).filter(Boolean).join(" · ")}. Retail ORI and SR series are non-tradable for a holding period and priced off a thin secondary market, so their spreads are noisier; the FR benchmarks sit almost on the curve because IGSYC is fitted to them. Hover or tap a dot for details.`;
  }

  // benchmark yield history (stored daily by the dashboard; PHEI shows only two days)
  function hist() {
    if (!window.LightweightCharts) return;
    if (!D?.benchHist || !Object.keys(D.benchHist).length) { $("bmHist").style.height = "0"; $("bmHNote").textContent = "Benchmark history starts with the next PHEI update: PHEI shows only the latest two days, so the dashboard stores each day as it comes in."; return; }
    $("bmHist").style.height = "300px";
    const opts = { autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 } };
    if (!ch) ch = LightweightCharts.createChart($("bmHist"), opts); else ch.applyOptions(opts);
    sers.forEach((s) => ch.removeSeries(s)); sers = [];
    const cols = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c1", "--c2"];
    const lines = [...pick].map((k, i) => ({ k, col: css(cols[i % cols.length]), data: (D.benchHist[k] || []).filter((r) => r[1] != null) })).filter((x) => x.data.length);
    lines.forEach((x, i) => { const s = ch.addLineSeries({ color: x.col, lineWidth: 2, lineStyle: i >= 6 ? 2 : 0, priceLineVisible: false, priceFormat: { type: "price", precision: 3, minMove: 0.001 } }); s.setData(x.data.map((r) => ({ time: r[0], value: r[1] }))); sers.push(s); });
    ch.timeScale().fitContent();
    const days = Math.max(0, ...lines.map((x) => x.data.length));
    $("bmHLeg").innerHTML = lines.map((x) => `<span><i style="background:${x.col};height:2.5px"></i>${esc(x.k)} <b>${f(x.data.at(-1)[1], 3)}%</b></span>`).join("");
    $("bmHNote").textContent = `PHEI fair yields of the selected benchmarks (click the tiles above to add or remove a series). PHEI publishes only the latest two days, so this history starts on the dashboard's first stored day and grows each Jakarta business day: ${days} day${days === 1 ? "" : "s"} so far. For a long INDOGB history use the 10Y and 15Y lines in Tenor history above.`;
  }
})();
