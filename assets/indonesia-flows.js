/* Indonesia tab: "JCI ↔ INDOGB flows", below the Indonesia bond market recap (port of assets/korea-flows.js).
   Daily foreign-flow proxies between Indonesian equities, the rupiah and INDOGBs (JCI, USD/IDR, 10Y IGSYC yield,
   INDOGB − UST spread) and the back-tested Bond Flow Signal, from the file's `daily` block (the weekly build still
   feeds the US Treasury transmission section). Data: data/indonesia-flows.json, built by
   scripts/fetch-indonesia-flows.mjs (indonesia-bonds workflow, after the PHEI close). The research narrative lives in
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
  const RNG = { "1Y": 252, "2Y": 504, All: 99999 }; // trading days (flows charts)
  const st = { rng: "2Y", inv: true, corr: false, bt: "hedged", ur: "2Y" };
  let D, F, U, charts = [], utCharts = [], syncing = false;

  fetch("../data/indonesia-flows.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d || !d.series?.length || !d.daily?.series?.length) return;
    D = d; U = d.ust || null; box.hidden = false;
    F = d.daily; // daily signal, charts and back-test
    if (!F.hedgedCurve?.length && st.bt === "hedged") st.bt = "bp";
    head(); story(); stats(); draw(); utDraw();
    const redraw = () => { draw(); utDraw(); };
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", redraw);
  });

  const rows = () => { const n = RNG[st.rng]; return F.series.slice(-n); };
  const C = { date: 0, csi: 1, y: 2, m: 3, dm: 4, sh: 5, S: 6, reg: 7, corr: 8 };

  function head() {
    const L = F.latest, [lab, tone] = REG[L.reg ?? 0];
    const comp = [
      ["Equity momentum", "JCI, 20 days", sgn(L.eq4, 1, "%"), L.z?.[0], 1],
      ["Rupiah flow", "USD/IDR, 20 days", sgn(L.fx4, 2, "%"), L.z?.[1], -1],
      ["10Y trend", "20-day change", sgn(L.dy4, 1, "bp"), L.z?.[2], -1],
      ["Spread value", "INDOGB − UST vs 130d avg", sgn(L.spDev, 0, "bp"), L.z?.[3], 1],
    ];
    $("flSig").innerHTML = `
      <div class="fl-chip ${tone}"><b>Signal · ${esc(fmtD(L.date))}</b><span>${esc(lab)}</span><em>${sgn(L.S, 2)}</em><small>prior day ${sgn(L.S1ago, 2)} · 20 days ago ${sgn(L.S20ago, 2)} · threshold ±${F.backtest.threshold}</small></div>
      <div class="fl-comp">${comp.map(([t, s, v, z, w]) => {
        const c = z == null ? 0 : w * z, pct = Math.min(50, Math.abs(c) * 20);
        return `<div><b>${esc(t)}</b><small>${esc(s)}</small><span class="v">${esc(v)}</span>
          <span class="fl-bar" title="Contribution to signal ${sgn(c, 2)} (positive = bond-bullish)"><i style="${c >= 0 ? "left:50%" : "right:50%"};width:${pct}%;background:var(--${c >= 0 ? "up" : "down"})"></i></span>
          <small>z ${sgn(z, 2)} → ${c >= 0 ? "bond-bullish" : "bond-bearish"} ${sgn(c, 2)}</small></div>`;
      }).join("")}</div>`;
    const n = D.notes;
    $("flHead").textContent = n?.headline || "";
    const A = U?.weekly?.attr;
    $("flUst").innerHTML = A ? `<b>US Treasury check:</b> over the last 4 weeks the 10Y INDOGB moved <b>${sgn(A.ktbBp)}bp</b>. The US 10Y moved ${sgn(A.ustBp)}bp, which at the current weekly beta of ${A.beta.toFixed(2)} accounts for <b>${sgn(A.ustPartBp)}bp</b>; the Indonesia-specific (local) part is <b>${sgn(A.localBp)}bp</b>.` : "";
  }

  function story() {
    const n = D.notes; if (!n) return;
    $("flNow").innerHTML = `<h3>Latest read <span class="mut">· ${esc(n.asof)}</span></h3><p>${esc(n.now)}</p><p><b>What would flip it.</b> ${esc(n.flip)}</p>`;
    $("flPhases").innerHTML = (n.phases || []).map(([p, t, x]) => `<li><b>${esc(p)}</b><strong>${esc(t)}</strong><p>${esc(x)}</p></li>`).join("");
    $("flCav").textContent = n.caveats || "";
  }

  function stats() {
    const b = F.backtest, h = F.hedged;
    const pc = (x) => x == null ? "—" : Math.round(x * 100) + "%";
    if (st.bt === "hedged" && h) {
      $("flStats").innerHTML = [
        ["\"Bond rally\" calls", `${pc(h.rally.hit)} right`, `${h.rally.n} days, hedged next-20d (outright ${pc(b.rally.hit)})`],
        ["\"Bond sell-off\" calls", `${pc(h.selloff.hit)} right`, `${h.selloff.n} days, hedged next-20d (outright ${pc(b.selloff.hit)})`],
        ["Long/short, UST-hedged", `${sgn(h.cumBp)}bp`, `Sharpe ${h.sharpe} · max DD ${h.maxDdBp}bp · vol ${h.volBp}bp/yr`],
        ["Long/short, outright", `${sgn(b.cumBp)}bp`, `Sharpe ${b.sharpe} · max DD ${b.maxDdBp}bp · vol ${b.volBp}bp/yr`],
        ...h.periods.map((p) => [`${p.label}`, `${sgn(p.hedged.cumBp)}bp hedged`, `Sharpe ${p.hedged.sharpe} hedged vs ${p.outright.sharpe} outright`]),
      ].map(([t, v, x]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
      $("flBtNote").textContent = `UST-hedged back-test, ${fmtD(h.from)} – ${fmtD(b.to)}, daily: after each Jakarta close the position for the next session is long (rally call) or short (sell-off call) the 10Y INDOGB against β × the 10Y US Treasury, with β the trailing 130-day daily beta known at the time (now ${h.beta}). That removes the part of the INDOGB move that simply followed Treasuries, and isolates the Indonesia-specific move. Treasury levels are the last New York close before each Jakarta close, so there is no look-ahead. "Right" is judged on the hedged move over the next ${b.horizonDays} sessions. No trading costs are taken off; the daily signal changes position more often than a weekly one would. Switch to "Outright 10Y" for the unhedged version.`;
    } else {
    $("flStats").innerHTML = [
      ["\"Bond rally\" calls", `${pc(b.rally.hit)} right`, `${b.rally.n} days · avg next-20d ${sgn(b.rally.avgFwdBp)}bp`],
      ["\"Bond sell-off\" calls", `${pc(b.selloff.hit)} right`, `${b.selloff.n} days · avg next-20d ${sgn(b.selloff.avgFwdBp)}bp`],
      ["All days (base rate)", `${sgn(b.allAvgFwdBp)}bp`, "avg next-20d 10Y change"],
      ["Long/flat on signal", `${sgn(b.longBp)}bp`, `Sharpe ${b.longSharpe} · max DD ${b.longMaxDdBp}bp`],
      ["Long/short on signal", `${sgn(b.cumBp)}bp`, `Sharpe ${b.sharpe} · max DD ${b.maxDdBp}bp`],
      ["Always long 10Y", `${sgn(b.holdBp)}bp`, `Sharpe ${b.holdSharpe} · max DD ${b.holdMaxDdBp}bp`],
    ].map(([t, v, s]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(s)}</small></div>`).join("");
    $("flBtNote").textContent = `Back-test ${fmtD(b.from)} – ${fmtD(b.to)}, ${b.days} sessions. Each day's signal is computed only from data up to that Jakarta close and positions the next session. "Right" means the 10Y moved the called way over the next ${b.horizonDays} sessions. P&L is the 10Y yield change captured, in bp (a 1bp fall is +1bp for a long), before trading costs. The long/flat strategy holds duration only on "bond rally" days (about ${Math.round((F.curve.filter((r) => r[7] > 0).length / F.curve.length) * 100)}% of the time). In total-return terms (a synthetic 10Y INDOGB with coupon carry and a duration of 7, in rupiah): long/flat ${sgn(b.etfLongPct, 1, "%")}, long/short ${sgn(b.etfStratPct, 1, "%")}, buy-and-hold ${sgn(b.etfHoldPct, 1, "%")}.`;
    }
    $("flEp").innerHTML = F.episodes.slice().reverse().map((e) => {
      const ok = e.type === "rally" ? e.bp < 0 : e.bp > 0;
      return `<tr><td>${esc(fmtD(e.from))}</td><td><span class="fl-tag ${e.type === "rally" ? "up" : "down"}">${e.type === "rally" ? "Bond rally" : "Bond sell-off"}</span></td><td>${e.days}</td><td>${e.y0.toFixed(3)}%</td><td>${e.y1.toFixed(3)}%</td><td class="${ok ? "up" : "down"}">${sgn(e.bp)}bp${e.open ? " *" : ""}</td><td>${e.open ? "running" : ok ? "✓" : "✗"}</td></tr>`;
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

    // 1. JCI vs 10Y
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
      $("flMainLeg").innerHTML = `<span><i style="background:${c2}"></i>JCI <b>${r[1].toFixed(0)}</b></span><span><i style="background:${c1}"></i>10Y INDOGB <b>${r[2].toFixed(3)}%</b>${st.inv ? " (axis inverted)" : ""}</span><span><i style="background:${alpha(up, 0.35)};height:10px"></i>Bond-rally days</span><span><i style="background:${alpha(dn, 0.35)};height:10px"></i>Bond-sell-off days</span><span class="mut">${esc(fmtD(r[0]))} · signal ${sgn(r[6], 2)}</span>`;
    });
    // 2. Flows: daily USD/IDR change (bars) + INDOGB − UST 10Y spread (line)
    const b = LightweightCharts.createChart($("flFlow"), { ...opts(), leftPriceScale: { visible: true, borderColor: css("--line") } });
    const mh = b.addHistogramSeries({ priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(1) + "%" } });
    mh.setData(R.filter((r) => r[4] != null).map((r) => ({ time: r[0], value: r[4], color: r[4] >= 0 ? alpha(dn, 0.85) : alpha(up, 0.85) })));
    const sh = b.addLineSeries({ color: c3, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) + "bp" } });
    sh.setData(R.filter((r) => r[5] != null).map((r) => ({ time: r[0], value: r[5] })));
    b.subscribeCrosshairMove((p) => {
      const r = p?.time ? R.find((x) => x[0] === p.time) : R.at(-1);
      if (!r) return;
      $("flFlowLeg").innerHTML = `<span><i style="background:${css("--down")};height:8px"></i>Rupiah weaker / <i style="background:${css("--up")};height:8px"></i>stronger <b>${sgn(r[4], 2, "%")}</b> on the day</span><span class="mut">USD/IDR ${r[3] ? Math.round(r[3]).toLocaleString("en-US") : "—"} · ${esc(fmtD(r[0]))}</span><span><i style="background:${c3}"></i>INDOGB − UST 10Y <b>${r[5] == null ? "—" : sgn(r[5], 0, "bp")}</b></span>`;
    });
    // 3. Signal
    const c = LightweightCharts.createChart($("flSigC"), opts());
    regBand(c, R);
    const s = c.addBaselineSeries({ baseValue: { type: "price", price: 0 }, topLineColor: up, bottomLineColor: dn, topFillColor1: alpha(up, 0.25), topFillColor2: alpha(up, 0.02), bottomFillColor1: alpha(dn, 0.02), bottomFillColor2: alpha(dn, 0.25), lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    s.setData(R.filter((r) => r[6] != null).map((r) => ({ time: r[0], value: r[6] })));
    [F.backtest.threshold, -F.backtest.threshold].forEach((v) => s.createPriceLine({ price: v, color: css("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: v > 0 ? "rally" : "sell-off" }));
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
      $("flSigLeg").innerHTML = `<span><i style="background:${up}"></i>Bond Flow Signal <b>${sgn(r[6], 2)}</b> → ${esc(lab)}</span>${st.corr ? `<span><i style="background:${c5}"></i>130-day stock/yield correlation <b>${sgn(r[8], 2)}</b> (positive = stocks up, yields up)</span>` : ""}<span class="mut">${esc(fmtD(r[0]))}</span>`;
    });
    // 4. Back-test curve
    const bd = F.curve.filter((r) => r[0] >= R[0][0]); let base0 = F.curve.filter((r) => r[0] < R[0][0]).at(-1);
    const off = (i) => (base0 ? base0[i] ?? 0 : 0);
    const e = LightweightCharts.createChart($("flBt"), opts());
    const HC = F.hedgedCurve, H = st.bt === "hedged" && HC?.length;
    const ix = H ? [2, 1, 11] : st.bt === "bp" ? [3, 1, 2] : [6, 4, 5], unit = st.bt === "etf" ? "%" : "bp";
    if (H) { // merge the hedged curve (cols 1, 2) with the outright long/short (col 11) on the same dates
      const om = new Map(F.curve.map((x) => [x[0], x[1]]));
      bd.length = 0; HC.filter((x) => x[0] >= R[0][0]).forEach((x) => { const row = [x[0], x[1], x[2]]; row[11] = om.get(x[0]) ?? null; bd.push(row); });
      const b0 = HC.filter((x) => x[0] < R[0][0]).at(-1), o0 = F.curve.filter((x) => x[0] < R[0][0]).at(-1);
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
      $("flBtLeg").innerHTML = lines.map(([, i, col, name]) => `<span><i style="background:${col}"></i>${name} <b>${sgn(r[i] - off(i), 1, unit)}</b></span>`).join("") + `<span class="mut">${st.bt === "etf" ? "synthetic 10Y total return" : st.bt === "hedged" ? "bp captured" : "10Y bp captured"} since ${esc(fmtD(bd[0][0]))}</span>`;
    });

    charts = [a, b, c, e];
    const grp = [a, b, c, e];
    grp.forEach((ch) => { ch.timeScale().fitContent(); ch.timeScale().subscribeVisibleTimeRangeChange((tr) => { if (syncing || !tr) return; syncing = true; grp.forEach((o) => o !== ch && o.timeScale().setVisibleRange(tr)); syncing = false; }); });
    seedLegends(R, bd, lines, off, unit); // legends show the latest day until the pointer moves
  }

  function seedLegends(R, bd, lines, off, unit) {
    const r = R.at(-1), up = css("--up"), dn = css("--down"), c1 = css("--c1"), c2 = css("--c2"), c3 = css("--c3"), c5 = css("--c5");
    $("flMainLeg").innerHTML = `<span><i style="background:${c2}"></i>JCI <b>${r[1].toFixed(0)}</b></span><span><i style="background:${c1}"></i>10Y INDOGB <b>${r[2].toFixed(3)}%</b>${st.inv ? " (axis inverted)" : ""}</span><span><i style="background:${alpha(up, 0.35)};height:10px"></i>Bond-rally days</span><span><i style="background:${alpha(dn, 0.35)};height:10px"></i>Bond-sell-off days</span><span class="mut">${esc(fmtD(r[0]))}</span>`;
    $("flFlowLeg").innerHTML = `<span><i style="background:${css("--down")};height:8px"></i>Rupiah weaker / <i style="background:${css("--up")};height:8px"></i>stronger <b>${sgn(r[4], 2, "%")}</b> on the day</span><span class="mut">USD/IDR ${r[3] ? Math.round(r[3]).toLocaleString("en-US") : "—"} · ${esc(fmtD(r[0]))}</span><span><i style="background:${c3}"></i>INDOGB − UST 10Y <b>${r[5] == null ? "—" : sgn(r[5], 0, "bp")}</b></span>`;
    $("flSigLeg").innerHTML = `<span><i style="background:${up}"></i>Bond Flow Signal <b>${sgn(r[6], 2)}</b> → ${esc(REG[r[7] ?? 0][0])}</span>${st.corr ? `<span><i style="background:${c5}"></i>130-day stock/yield correlation <b>${sgn(r[8], 2)}</b> (positive = stocks up, yields up)</span>` : ""}<span class="mut">${esc(fmtD(r[0]))}</span>`;
    const b = bd.at(-1);
    if (b) $("flBtLeg").innerHTML = lines.map(([, i, col, name]) => `<span><i style="background:${col}"></i>${name} <b>${sgn(b[i] - off(i), 1, unit)}</b></span>`).join("") + `<span class="mut">${st.bt === "etf" ? "synthetic 10Y total return" : st.bt === "hedged" ? "bp captured" : "10Y bp captured"} since ${esc(fmtD(bd[0][0]))}</span>`;
  }

  // ---------- US Treasury → INDOGB transmission ----------
  function utDraw() {
    if (!U || !$("ust")) return;
    $("ust").hidden = false;
    utCharts.forEach((c) => c.remove()); utCharts = [];
    const dl = U.daily, wk = U.weekly, c1 = css("--c1"), c2 = css("--c2"), c3 = css("--c3"), c5 = css("--c5"), mut = css("--muted");
    const on = dl.overnight;
    $("utOn").innerHTML = on ? `<b>Overnight read</b><span>New York ${esc(fmtD(on.to))}${on.sessions > 1 ? ` (${on.sessions} sessions)` : ""}: US 10Y <b>${sgn(on.du)}bp</b>${on.du2 != null ? `, 2Y ${sgn(on.du2)}bp` : ""}</span><span>→ at the 1-year beta of ${dl.y1.beta.toFixed(2)}, the 10Y INDOGB would move about <b>${sgn(on.impliedKtbBp)}bp</b> from the ${esc(fmtD(dl.to))} PHEI close</span>` : `<b>Overnight read</b><span>No New York session since the last PHEI close.</span>`;
    const pc = (x) => x == null ? "—" : Math.round(x * 100) + "%";
    $("utStats").innerHTML = [
      ["Daily beta, last year", `${dl.y1.beta.toFixed(2)}`, `INDOGB bp per 1bp US move · corr ${dl.y1.corr} · R² ${dl.y1.r2}`],
      ["Daily beta, last 60 days", `${dl.d60.beta.toFixed(2)}`, `corr ${dl.d60.corr} · 15Y INDOGB beta (1Y) ${dl.beta3y1}`],
      ["US rallies vs sell-offs", `${dl.down.beta.toFixed(2)} / ${dl.up.beta.toFixed(2)}`, `beta when US yields fall / rise (${dl.from.slice(0, 4)}–)`],
      ["Big US moves (≥7bp)", `${pc(dl.bigMoves.sameDir)} same way`, `${dl.bigMoves.n} days · median pass-through ${dl.bigMoves.medianPassThrough}`],
      ["Next-day spill-over", `${dl.nextDay.beta.toFixed(2)}`, `corr ${dl.nextDay.corr}: ${Math.abs(dl.nextDay.corr) < 0.1 ? "INDOGBs price the US move on the day" : "part of the US move carries into the next Jakarta day"}`],
      ["Weekly beta (26w)", `${wk.beta.toFixed(2)}`, `corr ${wk.corr} · weekly moves pass through more than daily`],
      ["INDOGB − UST 10Y", `${sgn(wk.spreadBp, 0)}bp`, `${Math.round(wk.spreadPct * 100)}th pct of 52w (${wk.spreadLo52} to ${wk.spreadHi52})`],
    ].map(([t, v, x]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
    const RW = { "1Y": 52, "2Y": 104, All: 9999 }[st.ur]; // weekly (transmission section)
    const S = D.series.filter((r) => r[15] != null).slice(-RW);
    // levels
    const a = LightweightCharts.createChart($("utLvl"), { ...opts(), leftPriceScale: { visible: true, borderColor: css("--line") } });
    const k = a.addLineSeries({ color: c1, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); k.setData(S.map((r) => ({ time: r[0], value: r[2] })));
    const u = a.addLineSeries({ color: c5, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); u.setData(S.map((r) => ({ time: r[0], value: r[15] })));
    const sp = a.addAreaSeries({ priceScaleId: "left", lineColor: alpha(mut, 0.8), topColor: alpha(mut, 0.18), bottomColor: alpha(mut, 0.02), lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) + "bp" } });
    sp.setData(S.map((r) => ({ time: r[0], value: r[17] })));
    a.priceScale("left").applyOptions({ scaleMargins: { top: 0.6, bottom: 0.02 } }); a.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } });
    const lv = (r) => { if (r) $("utLvlLeg").innerHTML = `<span><i style="background:${c1}"></i>INDOGB 10Y <b>${r[2].toFixed(3)}%</b></span><span><i style="background:${c5}"></i>UST 10Y <b>${r[15].toFixed(2)}%</b></span><span><i style="background:${alpha(mut, 0.5)};height:8px"></i>INDOGB − UST <b>${sgn(r[17], 0)}bp</b></span><span class="mut">week of ${esc(fmtD(r[0]))} · β ${r[16] ?? "—"}</span>`; };
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
    g += pts.map((p) => `<circle cx="${X(p[1]).toFixed(1)}" cy="${Y(p[2]).toFixed(1)}" r="2.6" fill="${c1}" fill-opacity=".35"><title>${p[0]}: US ${sgn(p[1])}bp, INDOGB ${sgn(p[2])}bp</title></circle>`).join("");
    const be = dl.y1.beta; g += `<line x1="${X(-mx)}" y1="${Y(-mx * be)}" x2="${X(mx)}" y2="${Y(mx * be)}" stroke="${c5}" stroke-width="2"/>`;
    g += `<line x1="${X(-mx)}" y1="${Y(-mx)}" x2="${X(mx)}" y2="${Y(mx)}" stroke="${mut}" stroke-dasharray="3 3"/>`;
    if (last) g += `<circle cx="${X(last[1])}" cy="${Y(last[2])}" r="5" fill="none" stroke="${css("--ink")}" stroke-width="1.5"/><text x="${X(last[1]) + 8}" y="${Y(last[2]) - 6}" fill="${css("--ink")}">${esc(last[0])}</text>`;
    g += `<text x="${W - P.r}" y="${P.t + 10}" text-anchor="end">fit β ${be.toFixed(2)} · dashed = 1:1</text>`;
    svg.innerHTML = g;
    const bl = (b) => b.lo <= -99 ? `below −${-b.hi}bp` : b.hi >= 99 ? `above +${b.lo}bp` : `${b.lo > 0 ? "+" : b.lo < 0 ? "−" : ""}${Math.abs(b.lo)} to ${b.hi > 0 ? "+" : b.hi < 0 ? "−" : ""}${Math.abs(b.hi)}bp`;
    $("utBk").innerHTML = dl.buckets.map((b) => `<tr><td>${bl(b)}</td><td>${b.n}</td><td>${sgn(b.du)}</td><td>${sgn(b.dk)}</td><td>${b.lo === -2 ? "—" : pc(b.same)}</td></tr>`).join("");
    $("utYr").innerHTML = dl.byYear.map((y) => `<tr><td>${y.year}${y.n < 200 ? "*" : ""}</td><td>${y.beta.toFixed(2)}</td><td>${y.beta3?.toFixed(2) ?? "—"}</td><td>${y.corr.toFixed(2)}</td><td>${y.r2.toFixed(2)}</td><td>${y.sdK}</td><td>${y.sdU}</td></tr>`).join("");
    $("utVar").innerHTML = U.variants.map((v) => `<tr class="${v.live ? "live" : ""}"><td>${esc(v.k)} · ${esc(v.name)}${v.live ? " <b>(live)</b>" : ""}</td><td>${sgn(v.outright.cumBp, 0)}</td><td>${v.outright.sharpe}</td><td>${pc(v.outright.rally.hit)}</td><td>${pc(v.outright.selloff.hit)}</td><td>${sgn(v.hedged.cumBp, 0)}</td><td><b>${v.hedged.sharpe}</b></td><td>${v.hedged.maxDdBp}</td><td>${pc(v.hedged.rally.hit)} / ${pc(v.hedged.selloff.hit)}</td></tr>`).join("");
    // reading computed from the variants, not written in: which way the evidence points can change as data arrives
    const V = Object.fromEntries(U.variants.map((v) => [v.k, v])), sh = (k, m = "outright") => V[k]?.[m]?.sharpe ?? null;
    const best = [...U.variants].sort((a, b) => (b.outright.sharpe ?? -9) - (a.outright.sharpe ?? -9))[0];
    const usAlone = sh("S4") ?? 0, addS1 = sh("S1") != null && sh("S1") > sh("S0") + 0.1, swapS2 = sh("S2") != null && sh("S2") > sh("S0") + 0.1, usHelps = addS1 || swapS2 || usAlone > (sh("S0") ?? 0) + 0.1;
    const rot = V.S3 ? ` The Korea-style rotation (S3, stocks down = bonds up) ${sh("S3") <= 0.1 ? `does not work here (Sharpe ${sh("S3")}): in Indonesia stocks, the rupiah and bonds have tended to move together with foreign money, which is why the live signal reads JCI the other way round` : `has a Sharpe of ${sh("S3")}, so a domestic rotation also shows up in the data`}.` : "";
    const us = usHelps ? ` Unlike Korea, the US 10Y trend carries information about INDOGBs over the following weeks: on its own (S4) it scores a Sharpe of ${usAlone}, and in place of the local 10Y trend (S2) ${sh("S2")}, against ${sh("S0")} for the live signal; ${addS1 ? `adding it on top (S1) also helps (${sh("S1")})` : `simply adding it as a fifth component (S1) does not help (${sh("S1")}), because it then shares the vote with the local trend that it largely duplicates`}. So Treasuries work as a predictor here, not only as a hedge.` : ` The US 10Y trend does not improve the live signal (S1 ${sh("S1")}, S2 ${sh("S2")}, S4 alone ${usAlone}, vs ${sh("S0")} live), so Treasuries matter here mainly as the hedge.`;
    const hedge = sh("S0", "hedged") != null && sh("S0", "hedged") > sh("S0") ? ` Hedging the live signal with β × UST lifts its Sharpe from ${sh("S0")} to ${sh("S0", "hedged")}.` : ` Hedging with β × UST does not lift the live signal (${sh("S0")} outright, ${sh("S0", "hedged")} hedged).`;
    $("utNote").textContent = `${U.method} Daily sample ${fmtD(dl.from)} – ${fmtD(dl.to)} (${dl.all.n} Jakarta sessions; * partial year). Reading: the strongest variant over the sample is ${best.k} (${best.name}, Sharpe ${best.outright.sharpe} outright).${us}${rot}${hedge} The live signal was fixed before these tests were run and is not switched to the best performer, because choosing the winner after the fact overstates how well it will do; the variants are shown so the evidence is visible.`;
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
  btns("flBtMode", [["hedged", "UST-hedged bp"], ["bp", "Outright 10Y bp"], ["etf", "10Y total return %"]], "bt", () => { stats(); draw(); });
})();
