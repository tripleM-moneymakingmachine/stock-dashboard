/* Malaysia tab: FX-swap implied ringgit yields, 1M–2Y, from the USD/MYR forward curve and US Treasury yields
   (covered interest parity), with the onshore comparison (T-bill ~1M joined to the FAST MGS curve) and the gap between
   them, plus a history chart. Data: data/malaysia-fxswap.json (scripts/fetch-malaysia-fxswap.mjs) and
   data/malaysia.json (onshore curve). */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("fxsTab")) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const f = (v, n = 3) => v == null || !isFinite(v) ? "–" : (+v).toFixed(n);
  const sgn = (v, d = 1) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const cls = (v) => v == null || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down";
  const SHOW = ["1M", "2M", "3M", "4M", "5M", "6M", "9M", "1Y", "2Y"];
  const YRS = { "1M": 1 / 12, "2M": 2 / 12, "3M": 0.25, "4M": 4 / 12, "5M": 5 / 12, "6M": 0.5, "9M": 0.75, "1Y": 1, "2Y": 2 };
  const COL = { "1M": "--c1", "3M": "--c4", "6M": "--c2", "1Y": "--c5", "2Y": "--c3" };
  const st = { on: ["1M", "3M", "6M", "1Y", "2Y"], gap: false };
  let X = null, M = null, ch = null, sers = [];
  const get = (u) => fetch(u + "?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([get("../data/malaysia-fxswap.json"), get("../data/malaysia.json")]).then(([x, m]) => {
    if (!x?.rows?.length) { $("fxsNote").textContent = "FX-swap implied yields are not in the data yet; they are added with the evening Malaysia data run."; return; }
    X = x; M = m; table(); chart();
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", chart);
  });
  // onshore ringgit rate at a tenor on a date: T-bill ~1M (FAST band 1) at 1 month, the FAST MGS curve from 1 year,
  // joined linearly in between
  const at = (s, d) => { if (!s?.length) return null; for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= d) return s[i][1]; return null; };
  function onshore(y, d) {
    const tb = at(M?.mm?.series?.mtb1, d), m1 = at(M?.tenors?.[1], d), m2 = at(M?.tenors?.[2], d);
    if (y >= 2) return m2; if (y >= 1) return m1 != null && m2 != null ? m1 + (m2 - m1) * (y - 1) : m1;
    if (tb == null || m1 == null) return null;
    return tb + (m1 - tb) * (y - 1 / 12) / (11 / 12);
  }
  const hist = (t) => X.hist?.[t] || [];
  const back = (s, days) => { if (!s.length) return null; const c = new Date(Date.parse(s.at(-1)[0]) - days * 864e5).toISOString().slice(0, 10); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= c) return s[i][1]; return null; };
  function table() {
    const d = X.date;
    $("fxsTab").innerHTML = X.rows.filter((r) => SHOW.includes(r.t)).map((r) => {
      const h = hist(r.t), d1 = h.length > 1 ? (h.at(-1)[1] - h.at(-2)[1]) * 100 : null, w1 = back(h, 7), m1 = back(h, 30);
      const on = onshore(YRS[r.t], d), gap = on != null ? (r.implied - on) * 100 : null;
      return `<tr><td>${r.t}</td><td>${f(r.fwd, 4)}</td><td>${sgn(r.pts, 0)}</td><td>${f(r.usd, 2)}</td><td><b>${f(r.implied, 2)}</b>${r.impliedBid != null ? ` <small class="mut">${f(r.impliedAsk, 2)}–${f(r.impliedBid, 2)}</small>` : ""}</td><td class="${cls(d1)}">${sgn(d1)}</td><td class="${cls(w1 == null ? null : (h.at(-1)[1] - w1) * 100)}">${w1 == null ? "–" : sgn((h.at(-1)[1] - w1) * 100)}</td><td class="${cls(m1 == null ? null : (h.at(-1)[1] - m1) * 100)}">${m1 == null ? "–" : sgn((h.at(-1)[1] - m1) * 100)}</td><td>${f(on, 3)}</td><td class="${cls(gap)}">${sgn(gap)}</td></tr>`;
    }).join("");
    const first = Object.values(X.hist || {}).map((s) => s[0]?.[0]).filter(Boolean).sort()[0];
    const miss = SHOW.filter((t) => !X.rows.some((r) => r.t === t));
    $("fxsNote").textContent = `Ringgit yields implied by the USD/MYR forward curve on ${d} (spot ${f(X.spot, 4)}): implied MYR = ((forward ÷ spot) × (1 + US rate × days/365) − 1) × 365/days, with the US Treasury par yield at the same tenor (${X.ustDate} New York close) as the dollar rate. Forwards are FXEmpire's indicative quotes; points are in pips (0.0001). The small range is the rate implied by the ask and bid forwards. "Onshore" is the T-bill ~1M rate (FAST) joined to the FAST MGS curve at 1 and 2 years; the gap (implied − onshore) is a cross-currency basis read: negative means ringgit is cheaper to raise through the FX swap than onshore, which tends to go with strong demand to hold ringgit or dollar funding pressure. Treasury bills usually yield a little less than dollar money-market rates (SOFR), so levels are indicative; the moves and the gap's trend matter more.${miss.length ? ` Not quoted today: ${miss.join(", ")}.` : ""} History from ${first || "–"}.`;
  }
  function chart() {
    if (!window.LightweightCharts) return;
    $("fxsBtns").innerHTML = SHOW.filter((t) => hist(t).length).map((t) => `<button type="button" data-k="${t}" aria-pressed="${st.on.includes(t)}">${t}</button>`).join("") + `<button type="button" data-k="gap" aria-pressed="${st.gap}" title="Implied minus onshore, bp">Gap to onshore</button>`;
    $("fxsBtns").querySelectorAll("button").forEach((b) => b.onclick = () => { const k = b.dataset.k; if (k === "gap") st.gap = !st.gap; else { st.on = st.on.includes(k) ? st.on.filter((x) => x !== k) : [...st.on, k]; if (!st.on.length) st.on = [k]; } chart(); });
    const o = { autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 }, localization: { locale: "en-US" } };
    if (!ch) ch = LightweightCharts.createChart($("fxsChart"), o); else ch.applyOptions(o);
    sers.forEach((s) => ch.removeSeries(s)); sers = [];
    const pal = ["--c1", "--c4", "--c2", "--c5", "--c3", "--c6"];
    const lines = SHOW.filter((t) => st.on.includes(t) && hist(t).length).map((t, i) => ({ t, col: css(COL[t] || pal[i % pal.length]), data: st.gap ? hist(t).map(([d, y]) => { const on = onshore(YRS[t], d); return on == null ? null : [d, +((y - on) * 100).toFixed(1)]; }).filter(Boolean) : hist(t) }));
    const pf = st.gap ? { type: "price", precision: 1, minMove: 0.1 } : { type: "price", precision: 2, minMove: 0.01 };
    for (const l of lines) { const s = ch.addLineSeries({ color: l.col, lineWidth: 2, priceLineVisible: false, priceFormat: pf }); s.setData(l.data.map(([time, value]) => ({ time, value }))); sers.push(s); }
    ch.timeScale().fitContent();
    $("fxsLeg").innerHTML = lines.map((l) => `<span><i style="background:${l.col};height:2.5px"></i>${esc(st.gap ? `${l.t} implied − onshore` : `${l.t} implied`)} <b>${l.data.length ? (st.gap ? sgn(l.data.at(-1)[1]) + " bp" : f(l.data.at(-1)[1], 2) + "%") : "–"}</b></span>`).join("");
  }
})();
