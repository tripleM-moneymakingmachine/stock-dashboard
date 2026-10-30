/* Korea tab: "KOSPI ↔ KTB rotation", below the Korea bond market recap (port of assets/china-flows.js).
   Weekly fund-flow proxies between Korean equities and KTBs (KOSPI, 10Y KTB yield, margin credit balance,
   30Y KTB ETF vs KOSPI 200 ETF turnover) and the back-tested Bond Rotation Signal. Data: data/korea-flows.json,
   built by scripts/fetch-korea-flows.mjs (korea-bonds workflow, daily 17:40 SGT). The research narrative lives in
   that file's `notes` / `events` and is preserved across rebuilds. */
(function () {
  const box = document.getElementById("flows");
  if (!box || !window.LightweightCharts) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const alpha = (hex, a) => { const h = hex.replace("#", ""); if (h.length !== 6) return hex; const n = parseInt(h, 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const sgn = (v, d = 1, u = "") => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + u;
  const fmtD = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const REG = { 1: ["Bond rally", "up"], 0: ["Neutral", "mut"], [-1]: ["Bond sell-off", "down"] };
  const RNG = { "1Y": 52, "2Y": 104, All: 9999 };
  const st = { rng: "2Y", inv: true, corr: false, bt: "hedged", ur: "2Y" };
  let D, U, charts = [], utCharts = [], syncing = false;

  fetch("../data/korea-flows.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d || !d.series?.length) return;
    D = d; U = d.ust || null; box.hidden = false;
    if (!U && st.bt === "hedged") st.bt = "bp";
    head(); story(); stats(); draw(); utDraw();
    const redraw = () => { draw(); utDraw(); };
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", redraw);
  });

  const rows = () => { const n = RNG[st.rng]; return D.series.slice(-n); };
  const C = { date: 0, csi: 1, y: 2, m: 3, dm: 4, sh: 5, S: 6, reg: 7, corr: 8 };

  function head() {
    const L = D.latest, [lab, tone] = REG[L.reg ?? 0];
    const comp = [
      ["Equity momentum", "KOSPI, 4 weeks", sgn(L.eq4, 1, "%"), L.z?.[0], -1],
      ["Leverage flow", "Margin credit, 4 weeks", sgn(L.dmAbs4, 1, " tn"), L.z?.[1], -1],
      ["Bond ETF share", "vs 26-week avg", sgn(L.bsDev, 1, "pp"), L.z?.[2], 1],
      ["10Y trend", "4-week change", sgn(L.dy4, 1, "bp"), L.z?.[3], -1],
    ];
    $("flSig").innerHTML = `
      <div class="fl-chip ${tone}"><b>Signal · week of ${esc(fmtD(L.date))}</b><span>${esc(lab)}</span><em>${sgn(L.S, 2)}</em><small>4 weeks ago ${sgn(L.S4ago, 2)} · threshold ±${D.backtest.threshold}</small></div>
      <div class="fl-comp">${comp.map(([t, s, v, z, w]) => {
        const c = z == null ? 0 : w * z, pct = Math.min(50, Math.abs(c) * 20);
        return `<div><b>${esc(t)}</b><small>${esc(s)}</small><span class="v">${esc(v)}</span>
          <span class="fl-bar" title="Contribution to signal ${sgn(c, 2)} (positive = bond-bullish)"><i style="${c >= 0 ? "left:50%" : "right:50%"};width:${pct}%;background:var(--${c >= 0 ? "up" : "down"})"></i></span>
          <small>z ${sgn(z, 2)} → ${c >= 0 ? "bond-bullish" : "bond-bearish"} ${sgn(c, 2)}</small></div>`;
      }).join("")}</div>`;
    const n = D.notes;
    $("flHead").textContent = n?.headline || "";
    const A = U?.weekly?.attr;
    $("flUst").innerHTML = A ? `<b>US Treasury check:</b> over the last 4 weeks the 10Y KTB moved <b>${sgn(A.ktbBp)}bp</b>. The US 10Y moved ${sgn(A.ustBp)}bp, which at the current weekly beta of ${A.beta.toFixed(2)} accounts for <b>${sgn(A.ustPartBp)}bp</b>; the Korea-specific (local) part is <b>${sgn(A.localBp)}bp</b>. The rotation signal is built to call the local part, so the back-test below is shown UST-hedged by default.` : "";
  }

  function story() {
    const n = D.notes; if (!n) return;
    $("flNow").innerHTML = `<h3>Latest read <span class="mut">· ${esc(n.asof)}</span></h3><p>${esc(n.now)}</p><p><b>What would flip it.</b> ${esc(n.flip)}</p>`;
    $("flPhases").innerHTML = (n.phases || []).map(([p, t, x]) => `<li><b>${esc(p)}</b><strong>${esc(t)}</strong><p>${esc(x)}</p></li>`).join("");
    $("flCav").textContent = n.caveats || "";
  }

  function stats() {
    const b = D.backtest;
    const pc = (x) => x == null ? "—" : Math.round(x * 100) + "%";
    if (st.bt === "hedged" && U) {
      const h = U.variants[0].hedged, o = U.variants[0].outright;
      $("flStats").innerHTML = [
        ["\"Bond rally\" calls", `${pc(h.rally.hit)} right`, `${h.rally.n} weeks, hedged next-4w (outright ${pc(o.rally.hit)})`],
        ["\"Bond sell-off\" calls", `${pc(h.selloff.hit)} right`, `${h.selloff.n} weeks, hedged next-4w (outright ${pc(o.selloff.hit)})`],
        ["Long/short, UST-hedged", `${sgn(h.cumBp)}bp`, `Sharpe ${h.sharpe} · max DD ${h.maxDdBp}bp · vol ${h.volBp}bp/yr`],
        ["Long/short, outright", `${sgn(o.cumBp)}bp`, `Sharpe ${o.sharpe} · max DD ${o.maxDdBp}bp · vol ${o.volBp}bp/yr`],
        ...U.periods.map((p) => [`${p.label}`, `${sgn(p.hedged.cumBp)}bp hedged`, `Sharpe ${p.hedged.sharpe} hedged vs ${p.outright.sharpe} outright`]),
      ].map(([t, v, x]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
      $("flBtNote").textContent = `UST-hedged back-test, ${fmtD(U.variants[0].from)} – ${fmtD(b.to)}: each week the position is long (rally call) or short (sell-off call) the 10Y KTB against β × the 10Y US Treasury, with β the trailing 26-week weekly beta known at the time (now ${U.weekly.beta}). That removes the part of the KTB move that simply followed Treasuries, and isolates the Korea-specific move the rotation signal is designed to call. Treasury levels are the last New York close before each KOFIA close, so there is no look-ahead. "Right" is judged on the hedged move over the next ${b.horizonWeeks} weeks. Switch to "Outright 10Y" for the unhedged version.`;
    } else {
    $("flStats").innerHTML = [
      ["\"Bond rally\" calls", `${pc(b.rally.hit)} right`, `${b.rally.n} weeks · avg next-4w ${sgn(b.rally.avgFwdBp)}bp`],
      ["\"Bond sell-off\" calls", `${pc(b.selloff.hit)} right`, `${b.selloff.n} weeks · avg next-4w ${sgn(b.selloff.avgFwdBp)}bp`],
      ["All weeks (base rate)", `${sgn(b.allAvgFwdBp)}bp`, "avg next-4w 10Y change"],
      ["Long/flat on signal", `${sgn(b.longBp)}bp`, `Sharpe ${b.longSharpe} · max DD ${b.longMaxDdBp}bp`],
      ["Long/short on signal", `${sgn(b.cumBp)}bp`, `Sharpe ${b.sharpe} · max DD ${b.maxDdBp}bp`],
      ["Always long 10Y", `${sgn(b.holdBp)}bp`, `Sharpe ${b.holdSharpe} · max DD ${b.holdMaxDdBp}bp`],
    ].map(([t, v, s]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(s)}</small></div>`).join("");
    $("flBtNote").textContent = `Back-test ${fmtD(b.from)} – ${fmtD(b.to)}, ${b.weeks} weeks. Each week's signal is computed only from data up to that week and positions the following week. "Right" means the 10Y moved the called way over the next ${b.horizonWeeks} weeks. P&L is the 10Y yield change captured, in bp (a 1bp fall is +1bp for a long). The long/flat strategy holds duration only in "bond rally" weeks (about ${Math.round((D.curve.filter((r) => r[7] > 0).length / D.curve.length) * 100)}% of the time). In 30Y KTB ETF (439870) terms: long/flat ${sgn(b.etfLongPct, 1, "%")}, long/short ${sgn(b.etfStratPct, 1, "%")}, buy-and-hold ${sgn(b.etfHoldPct, 1, "%")}.`;
    }
    $("flEp").innerHTML = D.episodes.slice().reverse().map((e) => {
      const ok = e.type === "rally" ? e.bp < 0 : e.bp > 0;
      return `<tr><td>${esc(fmtD(e.from))}</td><td><span class="fl-tag ${e.type === "rally" ? "up" : "down"}">${e.type === "rally" ? "Bond rally" : "Bond sell-off"}</span></td><td>${e.weeks}</td><td>${e.y0.toFixed(3)}%</td><td>${e.y1.toFixed(3)}%</td><td class="${ok ? "up" : "down"}">${sgn(e.bp)}bp${e.open ? " *" : ""}</td><td>${e.open ? "running" : ok ? "✓" : "✗"}</td></tr>`;
    }).join("");
  }

  // ---------- charts ----------
  const opts = () => ({ autoSize: true, localization: { locale: "en-US" }, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: alpha(css("--line"), 0.6) }, horzLines: { color: alpha(css("--line"), 0.6) } }, rightPriceScale: { borderColor: css("--line") }, leftPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 0 } });
  const regBand = (ch, data) => {
    const s = ch.addHistogramSeries({ priceScaleId: "reg", lastValueVisible: false, priceLineVisible: false, base: 0 });
    ch.priceScale("reg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    const up = alpha(css("--up"), 0.12), dn = alpha(css("--down"), 0.12);
    s.setData(data.map((r) => ({ time: r[0], value: 1, color: r[7] === 1 ? up : r[7] === -1 ? dn : "rgba(0,0,0,0)" })));
    return s;
  };
  const leg = (el, items) => { el.innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join(""); };

  function draw() {
    if (!D) return;
    charts.forEach((c) => c.remove()); charts = [];
    const R = rows(), dates = new Set(R.map((r) => r[0]));
    const ev = (D.events || []).filter(([d]) => d >= R[0][0]).map(([d, t]) => [R.find((r) => r[0] >= d)?.[0], t]).filter(([d]) => d && dates.has(d));
    const c1 = css("--c1"), c2 = css("--c2"), c3 = css("--c3"), c5 = css("--c5"), up = css("--up"), dn = css("--down"), ink = css("--ink");

    // 1. KOSPI vs 10Y
    const a = LightweightCharts.createChart($("flMain"), { ...opts(), leftPriceScale: { visible: true, borderColor: css("--line") } });
    regBand(a, R);
    const eq = a.addLineSeries({ color: c2, lineWidth: 2, priceScaleId: "left", priceLineVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    eq.setData(R.map((r) => ({ time: r[0], value: r[1] })));
    eq.setMarkers(ev.map(([d, t]) => ({ time: d, position: "aboveBar", color: ink, shape: "arrowDown", text: $("flMain").clientWidth < 640 ? "" : t })));
    const y = a.addLineSeries({ color: c1, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    y.setData(R.map((r) => ({ time: r[0], value: r[2] })));
    a.priceScale("right").applyOptions({ invertScale: st.inv, scaleMargins: { top: 0.12, bottom: 0.08 } });
    a.priceScale("left").applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 } });
    a.subscribeCrosshairMove((p) => {
      const r = p?.time ? R.find((x) => x[0] === p.time) : R.at(-1);
      if (!r) return;
      $("flMainLeg").innerHTML = `<span><i style="background:${c2}"></i>KOSPI <b>${r[1].toFixed(0)}</b></span><span><i style="background:${c1}"></i>10Y KTB <b>${r[2].toFixed(3)}%</b>${st.inv ? " (axis inverted)" : ""}</span><span><i style="background:${alpha(up, 0.35)};height:10px"></i>Bond-rally weeks</span><span><i style="background:${alpha(dn, 0.35)};height:10px"></i>Bond-sell-off weeks</span><span class="mut">week of ${esc(fmtD(r[0]))} · signal ${sgn(r[6], 2)}</span>`;
    });
    // 2. Flows: weekly margin change + bond ETF turnover share
    const b = LightweightCharts.createChart($("flFlow"), { ...opts(), leftPriceScale: { visible: true, borderColor: css("--line") } });
    const mh = b.addHistogramSeries({ priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    mh.setData(R.filter((r) => r[4] != null).map((r) => ({ time: r[0], value: r[4], color: r[4] >= 0 ? alpha(c2, 0.85) : alpha(c1, 0.85) })));
    const sh = b.addLineSeries({ color: c3, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) + "%" } });
    sh.setData(R.filter((r) => r[5] != null).map((r) => ({ time: r[0], value: r[5] })));
    b.subscribeCrosshairMove((p) => {
      const r = p?.time ? R.find((x) => x[0] === p.time) : R.at(-1);
      if (!r) return;
      $("flFlowLeg").innerHTML = `<span><i style="background:${c2};height:8px"></i>Margin credit added <b>${sgn(r[4], 1)} tn</b></span><span><i style="background:${c1};height:8px"></i>Margin credit repaid</span><span class="mut">balance KRW ${r[3]?.toFixed(1)} tn</span><span><i style="background:${c3}"></i>30Y KTB ETF share of ETF turnover <b>${r[5] == null ? "—" : r[5].toFixed(2) + "%"}</b></span>`;
    });
    // 3. Signal
    const c = LightweightCharts.createChart($("flSigC"), opts());
    regBand(c, R);
    const s = c.addBaselineSeries({ baseValue: { type: "price", price: 0 }, topLineColor: up, bottomLineColor: dn, topFillColor1: alpha(up, 0.25), topFillColor2: alpha(up, 0.02), bottomFillColor1: alpha(dn, 0.02), bottomFillColor2: alpha(dn, 0.25), lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    s.setData(R.filter((r) => r[6] != null).map((r) => ({ time: r[0], value: r[6] })));
    [D.backtest.threshold, -D.backtest.threshold].forEach((v) => s.createPriceLine({ price: v, color: css("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: v > 0 ? "rally" : "sell-off" }));
    let cs = null;
    if (st.corr) {
      cs = c.addLineSeries({ color: c5, lineWidth: 1.5, lineStyle: 0, priceScaleId: "corr", priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
      c.priceScale("corr").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      cs.setData(R.filter((r) => r[8] != null).map((r) => ({ time: r[0], value: r[8] })));
    }
    c.subscribeCrosshairMove((p) => {
      const r = p?.time ? R.find((x) => x[0] === p.time) : R.at(-1);
      if (!r) return;
      const [lab] = REG[r[7] ?? 0];
      $("flSigLeg").innerHTML = `<span><i style="background:${up}"></i>Bond Rotation Signal <b>${sgn(r[6], 2)}</b> → ${esc(lab)}</span>${st.corr ? `<span><i style="background:${c5}"></i>26-week stock/yield correlation <b>${sgn(r[8], 2)}</b> (positive = stocks up, yields up)</span>` : ""}<span class="mut">week of ${esc(fmtD(r[0]))}</span>`;
    });
    // 4. Back-test curve
    const bd = D.curve.filter((r) => r[0] >= R[0][0]); let base0 = D.curve.filter((r) => r[0] < R[0][0]).at(-1);
    const off = (i) => (base0 ? base0[i] ?? 0 : 0);
    const e = LightweightCharts.createChart($("flBt"), opts());
    const H = st.bt === "hedged" && U;
    const ix = H ? [2, 1, 11] : st.bt === "bp" ? [3, 1, 2] : [6, 4, 5], unit = st.bt === "etf" ? "%" : "bp";
    if (H) { // merge the hedged curve (cols 1, 2) with the outright long/short (col 11) on the same dates
      const hm = new Map(U.hedgedCurve.map((x) => [x[0], x])), om = new Map(D.curve.map((x) => [x[0], x[1]]));
      bd.length = 0; U.hedgedCurve.filter((x) => x[0] >= R[0][0]).forEach((x) => { const row = [x[0], x[1], x[2]]; row[11] = om.get(x[0]) ?? null; bd.push(row); });
      const b0 = U.hedgedCurve.filter((x) => x[0] < R[0][0]).at(-1), o0 = D.curve.filter((x) => x[0] < R[0][0]).at(-1);
      base0 = b0 ? [b0[0], b0[1], b0[2]] : null; if (base0) base0[11] = o0 ? o0[1] : 0;
    }
    const names = H ? ["Long/flat, UST-hedged", "Long/short, UST-hedged", "Long/short, outright"] : ["Long/flat on signal", "Long/short on signal", "Always long"];
    const lines = [[ix[0], up, names[0], 2.5], [ix[1], c1, names[1], 1.5], [ix[2], css("--muted"), names[2], 1.5]].map(([i, col, name, w]) => {
      const l = e.addLineSeries({ color: col, lineWidth: w, priceLineVisible: false, lastValueVisible: true, title: "", priceFormat: { type: "custom", formatter: (v) => v.toFixed(st.bt === "etf" ? 1 : 0) + unit } });
      l.setData(bd.filter((r) => r[i] != null).map((r) => ({ time: r[0], value: +(r[i] - off(i)).toFixed(2) })));
      return [l, i, col, name];
    });
    e.subscribeCrosshairMove((p) => {
      const r = p?.time ? bd.find((x) => x[0] === p.time) : bd.at(-1);
      if (!r) return;
      $("flBtLeg").innerHTML = lines.map(([, i, col, name]) => `<span><i style="background:${col}"></i>${name} <b>${sgn(r[i] - off(i), 1, unit)}</b></span>`).join("") + `<span class="mut">${st.bt === "etf" ? "439870 ETF return" : st.bt === "hedged" ? "bp captured" : "10Y bp captured"} since ${esc(fmtD(bd[0][0]))}</span>`;
    });

    charts = [a, b, c, e];
    const grp = [a, b, c, e];
    grp.forEach((ch) => { ch.timeScale().fitContent(); ch.timeScale().subscribeVisibleTimeRangeChange((tr) => { if (syncing || !tr) return; syncing = true; grp.forEach((o) => o !== ch && o.timeScale().setVisibleRange(tr)); syncing = false; }); });
    seedLegends(R, bd, lines, off, unit); // legends show the latest week until the pointer moves
  }

  function seedLegends(R, bd, lines, off, unit) {
    const r = R.at(-1), up = css("--up"), dn = css("--down"), c1 = css("--c1"), c2 = css("--c2"), c3 = css("--c3"), c5 = css("--c5");
    $("flMainLeg").innerHTML = `<span><i style="background:${c2}"></i>KOSPI <b>${r[1].toFixed(0)}</b></span><span><i style="background:${c1}"></i>10Y KTB <b>${r[2].toFixed(3)}%</b>${st.inv ? " (axis inverted)" : ""}</span><span><i style="background:${alpha(up, 0.35)};height:10px"></i>Bond-rally weeks</span><span><i style="background:${alpha(dn, 0.35)};height:10px"></i>Bond-sell-off weeks</span><span class="mut">week of ${esc(fmtD(r[0]))}</span>`;
    $("flFlowLeg").innerHTML = `<span><i style="background:${c2};height:8px"></i>Margin credit added <b>${sgn(r[4], 1)} tn</b></span><span><i style="background:${c1};height:8px"></i>Margin credit repaid</span><span class="mut">balance KRW ${r[3]?.toFixed(1)} tn</span><span><i style="background:${c3}"></i>30Y KTB ETF share of ETF turnover <b>${r[5] == null ? "—" : r[5].toFixed(2) + "%"}</b></span>`;
    $("flSigLeg").innerHTML = `<span><i style="background:${up}"></i>Bond Rotation Signal <b>${sgn(r[6], 2)}</b> → ${esc(REG[r[7] ?? 0][0])}</span>${st.corr ? `<span><i style="background:${c5}"></i>26-week stock/yield correlation <b>${sgn(r[8], 2)}</b> (positive = stocks up, yields up)</span>` : ""}`;
    const b = bd.at(-1);
    if (b) $("flBtLeg").innerHTML = lines.map(([, i, col, name]) => `<span><i style="background:${col}"></i>${name} <b>${sgn(b[i] - off(i), 1, unit)}</b></span>`).join("") + `<span class="mut">${st.bt === "etf" ? "439870 ETF return" : st.bt === "hedged" ? "bp captured" : "10Y bp captured"} since ${esc(fmtD(bd[0][0]))}</span>`;
  }

  // ---------- US Treasury → KTB transmission ----------
  function utDraw() {
    if (!U || !$("ust")) return;
    $("ust").hidden = false;
    utCharts.forEach((c) => c.remove()); utCharts = [];
    const dl = U.daily, wk = U.weekly, c1 = css("--c1"), c2 = css("--c2"), c3 = css("--c3"), c5 = css("--c5"), mut = css("--muted");
    const on = dl.overnight;
    $("utOn").innerHTML = on ? `<b>Overnight read</b><span>New York ${esc(fmtD(on.to))}${on.sessions > 1 ? ` (${on.sessions} sessions)` : ""}: US 10Y <b>${sgn(on.du)}bp</b>${on.du2 != null ? `, 2Y ${sgn(on.du2)}bp` : ""}</span><span>→ at the 1-year beta of ${dl.y1.beta.toFixed(2)}, KTB 10Y would open about <b>${sgn(on.impliedKtbBp)}bp</b> from the ${esc(fmtD(dl.to))} KOFIA close</span>` : `<b>Overnight read</b><span>No New York session since the last KOFIA close.</span>`;
    const pc = (x) => x == null ? "—" : Math.round(x * 100) + "%";
    $("utStats").innerHTML = [
      ["Daily beta, last year", `${dl.y1.beta.toFixed(2)}`, `KTB bp per 1bp US move · corr ${dl.y1.corr} · R² ${dl.y1.r2}`],
      ["Daily beta, last 60 days", `${dl.d60.beta.toFixed(2)}`, `corr ${dl.d60.corr} · 3Y KTB beta (1Y) ${dl.beta3y1}`],
      ["US rallies vs sell-offs", `${dl.down.beta.toFixed(2)} / ${dl.up.beta.toFixed(2)}`, `beta when US yields fall / rise (${dl.from.slice(0, 4)}–)`],
      ["Big US moves (≥7bp)", `${pc(dl.bigMoves.sameDir)} same way`, `${dl.bigMoves.n} days · median pass-through ${dl.bigMoves.medianPassThrough}`],
      ["Next-day spill-over", `${dl.nextDay.beta.toFixed(2)}`, `corr ${dl.nextDay.corr}: KTBs price the US move on the day`],
      ["Weekly beta (26w)", `${wk.beta.toFixed(2)}`, `corr ${wk.corr} · weekly moves pass through more than daily`],
      ["KTB − UST 10Y", `${sgn(wk.spreadBp, 0)}bp`, `${Math.round(wk.spreadPct * 100)}th pct of 52w (${wk.spreadLo52} to ${wk.spreadHi52})`],
    ].map(([t, v, x]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
    const RW = { "1Y": 52, "2Y": 104, All: 9999 }[st.ur];
    const S = D.series.filter((r) => r[15] != null).slice(-RW);
    // levels
    const a = LightweightCharts.createChart($("utLvl"), { ...opts(), leftPriceScale: { visible: true, borderColor: css("--line") } });
    const k = a.addLineSeries({ color: c1, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); k.setData(S.map((r) => ({ time: r[0], value: r[2] })));
    const u = a.addLineSeries({ color: c5, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); u.setData(S.map((r) => ({ time: r[0], value: r[15] })));
    const sp = a.addAreaSeries({ priceScaleId: "left", lineColor: alpha(mut, 0.8), topColor: alpha(mut, 0.18), bottomColor: alpha(mut, 0.02), lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) + "bp" } });
    sp.setData(S.map((r) => ({ time: r[0], value: r[17] })));
    a.priceScale("left").applyOptions({ scaleMargins: { top: 0.6, bottom: 0.02 } }); a.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } });
    const lv = (r) => { if (r) $("utLvlLeg").innerHTML = `<span><i style="background:${c1}"></i>KTB 10Y <b>${r[2].toFixed(3)}%</b></span><span><i style="background:${c5}"></i>UST 10Y <b>${r[15].toFixed(2)}%</b></span><span><i style="background:${alpha(mut, 0.5)};height:8px"></i>KTB − UST <b>${sgn(r[17], 0)}bp</b></span><span class="mut">week of ${esc(fmtD(r[0]))} · β ${r[16] ?? "—"}</span>`; };
    a.subscribeCrosshairMove((p) => lv(p?.time ? S.find((x) => x[0] === p.time) : S.at(-1))); lv(S.at(-1)); a.timeScale().fitContent();
    // rolling beta / corr
    const cut = S[0]?.[0] || "";
    const RR = dl.roll.filter((x) => x[0] >= cut);
    const b = LightweightCharts.createChart($("utRoll"), opts());
    const bb = b.addLineSeries({ color: c1, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); bb.setData(RR.map((x) => ({ time: x[0], value: x[1] })));
    const cc = b.addLineSeries({ color: c3, lineWidth: 1.5, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); cc.setData(RR.map((x) => ({ time: x[0], value: x[2] })));
    bb.createPriceLine({ price: dl.all.beta, color: mut, lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: "avg β" });
    const rl = (x) => { if (x) $("utRollLeg").innerHTML = `<span><i style="background:${c1}"></i>60-day beta <b>${x[1].toFixed(2)}</b></span><span><i style="background:${c3}"></i>60-day correlation <b>${x[2].toFixed(2)}</b></span><span class="mut">${esc(fmtD(x[0]))}</span>`; };
    b.subscribeCrosshairMove((p) => rl(p?.time ? RR.find((x) => x[0] === p.time) : RR.at(-1))); rl(RR.at(-1)); b.timeScale().fitContent();
    utCharts = [a, b];
    // scatter
    const svg = $("utSc"), W = Math.max(300, svg.clientWidth || 520), Hh = 300, P = { l: 36, r: 10, t: 10, b: 26 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const pts = dl.scatter, mx = Math.max(12, ...pts.map((p) => Math.abs(p[1]))), my = Math.max(10, ...pts.map((p) => Math.abs(p[2])));
    const X = (v) => P.l + (v + mx) / (2 * mx) * (W - P.l - P.r), Y = (v) => P.t + (my - v) / (2 * my) * (Hh - P.t - P.b);
    let g = `<line x1="${X(-mx)}" x2="${X(mx)}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)"/><line x1="${X(0)}" x2="${X(0)}" y1="${Y(my)}" y2="${Y(-my)}" stroke="var(--line)"/>`;
    for (const v of [-10, -5, 5, 10]) if (Math.abs(v) <= mx) g += `<text x="${X(v)}" y="${Hh - 8}" text-anchor="middle">${v}</text>`;
    for (const v of [-10, -5, 5, 10]) if (Math.abs(v) <= my) g += `<text x="${P.l - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
    const last = pts.at(-1);
    g += pts.map((p) => `<circle cx="${X(p[1]).toFixed(1)}" cy="${Y(p[2]).toFixed(1)}" r="2.6" fill="${c1}" fill-opacity=".35"><title>${p[0]}: US ${sgn(p[1])}bp, KTB ${sgn(p[2])}bp</title></circle>`).join("");
    const be = dl.y1.beta; g += `<line x1="${X(-mx)}" y1="${Y(-mx * be)}" x2="${X(mx)}" y2="${Y(mx * be)}" stroke="${c5}" stroke-width="2"/>`;
    g += `<line x1="${X(-mx)}" y1="${Y(-mx)}" x2="${X(mx)}" y2="${Y(mx)}" stroke="${mut}" stroke-dasharray="3 3"/>`;
    if (last) g += `<circle cx="${X(last[1])}" cy="${Y(last[2])}" r="5" fill="none" stroke="${css("--ink")}" stroke-width="1.5"/><text x="${X(last[1]) + 8}" y="${Y(last[2]) - 6}" fill="${css("--ink")}">${esc(last[0])}</text>`;
    g += `<text x="${W - P.r}" y="${P.t + 10}" text-anchor="end">fit β ${be.toFixed(2)} · dashed = 1:1</text>`;
    svg.innerHTML = g;
    const bl = (b) => b.lo <= -99 ? `below −${-b.hi}bp` : b.hi >= 99 ? `above +${b.lo}bp` : `${b.lo > 0 ? "+" : b.lo < 0 ? "−" : ""}${Math.abs(b.lo)} to ${b.hi > 0 ? "+" : b.hi < 0 ? "−" : ""}${Math.abs(b.hi)}bp`;
    $("utBk").innerHTML = dl.buckets.map((b) => `<tr><td>${bl(b)}</td><td>${b.n}</td><td>${sgn(b.du)}</td><td>${sgn(b.dk)}</td><td>${b.lo === -2 ? "—" : pc(b.same)}</td></tr>`).join("");
    $("utYr").innerHTML = dl.byYear.map((y) => `<tr><td>${y.year}${y.n < 200 ? "*" : ""}</td><td>${y.beta.toFixed(2)}</td><td>${y.beta3?.toFixed(2) ?? "—"}</td><td>${y.corr.toFixed(2)}</td><td>${y.r2.toFixed(2)}</td><td>${y.sdK}</td><td>${y.sdU}</td></tr>`).join("");
    $("utVar").innerHTML = U.variants.map((v) => `<tr class="${v.live ? "live" : ""}"><td>${esc(v.k)} · ${esc(v.name)}${v.live ? " <b>(live)</b>" : ""}</td><td>${sgn(v.outright.cumBp, 0)}</td><td>${v.outright.sharpe}</td><td>${pc(v.outright.rally.hit)}</td><td>${pc(v.outright.selloff.hit)}</td><td>${sgn(v.hedged.cumBp, 0)}</td><td><b>${v.hedged.sharpe}</b></td><td>${v.hedged.maxDdBp}</td><td>${pc(v.hedged.rally.hit)} / ${pc(v.hedged.selloff.hit)}</td></tr>`).join("");
    $("utNote").textContent = `${U.method} Daily sample ${fmtD(dl.from)} – ${fmtD(dl.to)} (${dl.all.n} Seoul sessions; * partial year). Reading: adding the US 10Y trend to the signal (S1, S2) lowers the Sharpe, and the US trend alone (S4) has no edge: last week's Treasury move does not predict next week's KTB move, because KTBs absorb it the same day. Treasuries matter as the hedge, not as a predictor: trading the live signal against β × UST raises the Sharpe and the hit rates and cuts the drawdown, in both halves of the sample.`;
  }

  // ---------- controls ----------
  const btns = (id, list, key, after) => {
    const el = $(id); if (!el) return;
    el.innerHTML = list.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${String(st[key]) === String(v)}">${t}</button>`).join("");
    el.addEventListener("click", (ev) => {
      const bt = ev.target.closest("button"); if (!bt) return;
      const v = bt.dataset.v; st[key] = v === "true" ? true : v === "false" ? false : v;
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === v)));
      (after || draw)();
    });
  };
  btns("flRng", Object.keys(RNG).map((k) => [k, k]), "rng");
  btns("utRng", Object.keys(RNG).map((k) => [k, k]), "ur", () => utDraw());
  btns("flInv", [["true", "Yield inverted"], ["false", "Yield normal"]], "inv");
  btns("flCorr", [["false", "Signal only"], ["true", "+ correlation"]], "corr");
  btns("flBtMode", [["hedged", "UST-hedged bp"], ["bp", "Outright 10Y bp"], ["etf", "439870 ETF %"]], "bt", () => { stats(); draw(); });
})();
