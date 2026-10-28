/* FX tab: "USD/TWD · Taiwan equity flow signal".
   Foreign investor (FINI) net buying of TWSE shares and the TAIEX against USD/TWD, two back-tested readings
   (flow pressure, 1–2 days; flow exhaustion, ~1 month) and the research write-up. Data: data/twd-flows.json, built by
   scripts/fetch-twd-flows.mjs + scripts/twd-signal.mjs (workflow twd-flows.yml, after each Taipei close). The research
   text lives in that file's `notes` and is kept across rebuilds. */
(function () {
  const box = document.getElementById("twd");
  if (!box || !window.LightweightCharts) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  const alpha = (hex, a) => { const h = hex.replace("#", ""); if (h.length !== 6) return hex; const n = parseInt(h, 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const sgn = (v, d = 1, u = "") => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + u;
  const pc = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
  const fmtD = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const st = document.createElement("style");
  st.textContent = `
.tw h2{margin-top:2px}
.tw-head{font:600 16px/1.45 var(--f-body);margin:0 0 14px;max-width:100ch}
.tw-top{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 12px}
.tw-chip{border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:6px;padding:14px;background:var(--panel);min-width:0}
.tw-chip b{display:block;font:600 11px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.tw-chip span{display:block;font:700 22px/1.15 var(--f-display);margin:8px 0 2px}
.tw-chip em{display:block;font:600 18px var(--f-mono);font-style:normal;font-variant-numeric:tabular-nums}
.tw-chip small{display:block;font:500 11px var(--f-mono);color:var(--muted);margin-top:6px;line-height:1.45}
.tw-chip.up{border-left-color:var(--up)}.tw-chip.up span,.tw-chip.up em{color:var(--up)}
.tw-chip.down{border-left-color:var(--down)}.tw-chip.down span,.tw-chip.down em{color:var(--down)}
.tw-chip.warn{border-left-color:#d97706}.tw-chip.warn span{color:#d97706}
.tw-comp{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:0 0 16px}
.tw-comp>div{border:1px solid var(--line);border-radius:6px;padding:10px 12px;background:var(--panel);min-width:0}
.tw-comp b{display:block;font:600 11px var(--f-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.tw-comp small{display:block;font:500 11px var(--f-mono);color:var(--muted)}
.tw-comp .v{display:block;font:600 18px var(--f-mono);font-variant-numeric:tabular-nums;margin:4px 0}
.tw-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.tw-two{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:16px}
@media (max-width:860px){.tw-top,.tw-two{grid-template-columns:minmax(0,1fr)}}
.tw-now h3{font:600 17px var(--f-body);margin:0 0 6px}.tw-now p{margin:0 0 10px;max-width:90ch}
.tw-f{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.tw-f li{border-left:2px solid var(--line);padding:0 0 0 12px}
.tw-f b{display:block;font:600 13px var(--f-body);margin-bottom:2px}.tw-f p{margin:0;font-size:14px;color:var(--muted)}
.tw-ep{width:100%;border-collapse:collapse;font:500 12px var(--f-mono);font-variant-numeric:tabular-nums}
.tw-ep th,.tw-ep td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.tw-ep th:first-child,.tw-ep td:first-child,.tw-ep th:nth-child(2),.tw-ep td:nth-child(2){text-align:left}
.tw-ep th{color:var(--muted);font-weight:600}
.tw-tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px}
.tw-tag.up{background:${"rgba(19,128,75,.12)"};color:var(--up)}.tw-tag.down{background:rgba(194,54,43,.12);color:var(--down)}
.tw .btns{display:flex;gap:4px;flex-wrap:wrap}
.tw .btns button{font:500 12px var(--f-mono);border:1px solid var(--line);background:var(--panel);color:var(--muted);padding:4px 10px;border-radius:4px;cursor:pointer}
.tw .btns button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
.tw .mut{color:var(--muted)}
.tw .stats small{display:block;font:500 11px var(--f-mono);color:var(--muted);margin-top:2px;line-height:1.4}`;
  document.head.appendChild(st);

  const RNG = { "6M": 126, "1Y": 252, "2Y": 504, All: 9999 };
  const S = { rng: "1Y" };
  try { S.rng = localStorage.getItem("twd-rng") || S.rng; } catch (e) {}
  let D, charts = [];
  const $ = (id) => document.getElementById(id);

  fetch("../data/twd-flows.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d || !d.series?.length || !d.backtest) return;
    D = d; box.hidden = false; shell(); top(); story(); bt(); draw();
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
  });

  function shell() {
    box.innerHTML = `
    <div class="eyebrow">USD/TWD · Taiwan equity flows · daily</div>
    <h2 id="twH">USD/TWD: Taiwan equity flow signal</h2>
    <p class="sub">Does foreign money leaving Taiwan stocks weaken the Taiwan dollar, and does it tell you where USD/TWD goes next? This panel tracks foreign investors' (FINI) daily net buying of TWSE-listed shares and the TAIEX against USD/TWD. It turns them into two signals, each back-tested over the last two years using only data available at the time. Positive readings point to a higher USD/TWD, meaning a weaker TWD.</p>
    <p class="tw-head" id="twHead"></p>
    <div class="tw-top" id="twTop"></div>
    <div class="tw-comp" id="twComp"></div>
    <div class="tw-grid">
      <div class="panel">
        <div class="chead"><h3>USD/TWD vs foreign net buying</h3><div class="btns" id="twRng" role="group" aria-label="Range"></div></div>
        <div id="twMain" style="height:300px"></div>
        <div id="twFlow" style="height:150px;border-top:1px dashed var(--line);margin-top:4px"></div>
        <div class="leg" id="twMainLeg"></div>
        <p class="note">Top: USD/TWD (right axis) and TAIEX (left axis). Shading marks the flow-exhaustion regime: green when inflows are stretched (a long USD/TWD signal) and red when outflows are stretched (a warning only, no back-tested edge). Bottom: foreign net buy of TWSE shares, TWD bn per day. Red bars are net selling. The line is the 20-day total ÷ 10.</p>
      </div>
      <div class="panel">
        <div class="chead"><h3>Signals</h3></div>
        <div id="twSig" style="height:200px"></div>
        <div class="leg" id="twSigLeg"></div>
        <p class="note"><b>Flow pressure</b> = −average of z-scores of FINI net ÷ gross turnover over 1 and 5 days. At +0.5 or above, foreigners are selling hard, which leans long USD/TWD for 1–2 days. At −0.5 or below, they are buying, which leans short. <b>Flow exhaustion</b> = average of z-scores of FINI net ÷ gross over 20 days and the TAIEX 20-day return. At +1 or above, inflows are stretched and the TWD has tended to give back gains over the next month. Each z-score is against the trailing 250 sessions only.</p>
      </div>
      <div class="tw-two">
        <div class="panel tw-now" id="twNow"></div>
        <div class="panel"><h3 style="font:600 17px var(--f-body);margin:0 0 8px">What the research found</h3><ul class="tw-f" id="twFind"></ul></div>
      </div>
      <div class="panel">
        <div class="chead"><h3>Back-test, last two years</h3></div>
        <div class="stats" id="twStats"></div>
        <div id="twBt" style="height:240px;margin-top:12px"></div>
        <div class="leg" id="twBtLeg"></div>
        <p class="note" id="twBtNote"></p>
        <div style="overflow-x:auto;margin-top:12px"><table class="tw-ep" aria-label="Flow exhaustion episodes"><thead><tr><th>From</th><th>Regime</th><th>Days</th><th>Reading</th><th>USD/TWD</th><th>Next 20d</th><th>TWD weaker?</th></tr></thead><tbody id="twEp"></tbody></table></div>
        <p class="note">Flow-exhaustion episodes, newest first. "Next 20d" is the USD/TWD change over the 20 sessions after the day the episode started. * still running.</p>
        <p class="note" id="twCav"></p>
      </div>
    </div>`;
    $("twRng").innerHTML = Object.keys(RNG).map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === S.rng}">${k}</button>`).join("");
    $("twRng").onclick = (e) => { const k = e.target.dataset?.k; if (!k) return; S.rng = k; try { localStorage.setItem("twd-rng", k); } catch (x) {} $("twRng").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k)); draw(); };
  }

  function top() {
    const L = D.latest, n = D.notes || {}, b = D.backtest;
    $("twHead").textContent = n.headline || "";
    const pT = L.rA === 1 ? ["Selling pressure", "up", "lean long USD/TWD, next 1–2 days"] : L.rA === -1 ? ["Buying pressure", "down", "lean short USD/TWD, next 1–2 days"] : ["Neutral", "", "no 1–2 day lean"];
    const eT = L.rC === 1 ? ["Inflows stretched", "up", "long USD/TWD over ~1 month"] : L.rC === -1 ? ["Outflows stretched", "warn", "warning only: no rebound edge in the back-test"] : ["Neutral", "", "no one-month signal"];
    $("twTop").innerHTML = `
      <div class="tw-chip ${esc(n.callTone || "")}"><b>Verdict · ${esc(n.asof || fmtD(L.date))}</b><span>${esc(n.call || "—")}</span><small>A judgment call that combines both signals with their back-test record. Not financial advice.</small></div>
      <div class="tw-chip ${pT[1]}"><b>Flow pressure · ${esc(fmtD(L.date))}</b><span>${pT[0]}</span><em>${sgn(L.A, 2)}</em><small>${pT[2]} · threshold ±${b.pressure.threshold} · 5 sessions ago ${sgn(L.A5ago, 2)}</small></div>
      <div class="tw-chip ${eT[1]}"><b>Flow exhaustion · ${esc(fmtD(L.date))}</b><span>${eT[0]}</span><em>${sgn(L.C, 2)}</em><small>${eT[2]} · threshold ±${b.exhaustion.threshold} · 5 sessions ago ${sgn(L.C5ago, 2)}</small></div>`;
    const tone = (v, inv) => (v == null ? "" : (inv ? -v : v) > 0 ? "up" : (inv ? -v : v) < 0 ? "down" : "");
    $("twComp").innerHTML = [
      ["FINI net buy", "latest session", sgn(L.net, 1, " bn"), `${sgn(L.x1, 1, "%")} of gross · z ${sgn(L.z.x1, 2)}`, L.net],
      ["FINI 5 days", "net ÷ gross", sgn(L.x5, 1, "%"), `z ${sgn(L.z.x5, 2)}`, L.x5],
      ["FINI 20 days", "net buy, TWD bn", sgn(L.net20, 0, " bn"), `${sgn(L.x20, 1, "%")} of gross · z ${sgn(L.z.x20, 2)}`, L.net20],
      ["FINI 60 days", "net buy, TWD bn", sgn(L.net60, 0, " bn"), "cumulative", L.net60],
      ["TAIEX", "20-day change", sgn(L.eq20, 1, "%"), `${Math.round(L.taiex).toLocaleString("en-US")} · z ${sgn(L.z.eq20, 2)}`, L.eq20],
      ["USD/TWD", "20-day change", sgn(L.fx20, 1, "%"), `${L.fx.toFixed(3)} · + = TWD weaker`, -L.fx20],
    ].map(([t, s, v, x, c]) => `<div><b>${esc(t)}</b><small>${esc(s)}</small><span class="v ${tone(c)}">${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
  }

  function story() {
    const n = D.notes; if (!n) return;
    $("twNow").innerHTML = `<h3>Latest read <span class="mut">· ${esc(n.asof)}</span></h3><p>${esc(n.now)}</p><p><b>What would change it.</b> ${esc(n.flip)}</p>`;
    $("twFind").innerHTML = (n.findings || []).map(([h, p]) => `<li><b>${esc(h)}</b><p>${esc(p)}</p></li>`).join("");
    $("twCav").textContent = n.caveats || "";
  }

  function bt() {
    const b = D.backtest, P = b.pressure, E = b.exhaustion;
    $("twStats").innerHTML = [
      ["Pressure, same day", `${sgn(P.sameDay.cumPct, 1, "%")}`, `Sharpe ${P.sameDay.sharpe} · max DD ${P.sameDay.maxDdPct}%`],
      ["Pressure, 1 day late", `${sgn(P.oneDayLate.cumPct, 1, "%")}`, `Sharpe ${P.oneDayLate.sharpe} · IC ${P.ic1Late.ic} vs ${P.ic1.ic}`],
      ["Pressure calls, next 2d", `${pc(P.next2d.long.hit)} / ${pc(P.next2d.short.hit)}`, `right on long / short days (${P.next2d.long.days} / ${P.next2d.short.days})`],
      ["Inflows stretched → long", `${E.episodes.long.right} of ${E.episodes.long.n}`, `episodes right · avg next 20d ${sgn(E.episodes.long.avgFwd20Pct, 2, "%")}`],
      ["Outflows stretched → short", `${E.episodes.short.right} of ${E.episodes.short.n}`, `episodes right · avg next 20d ${sgn(E.episodes.short.avgFwd20Pct, 2, "%")}`],
      ["Exhaustion, long only", `${sgn(E.longOnly.cumPct, 1, "%")}`, `Sharpe ${E.longOnly.sharpe} · max DD ${E.longOnly.maxDdPct}%`],
      ["Always long USD/TWD", `${sgn(b.hold.cumPct, 1, "%")}`, `Sharpe ${b.hold.sharpe} · max DD ${b.hold.maxDdPct}%`],
      ["Same-week link", `${sgn(b.contemp5dCorr, 2)}`, "corr, 5-day FINI flow vs USD/TWD"],
    ].map(([t, v, s]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(s)}</small></div>`).join("");
    $("twBtNote").textContent = `${fmtD(b.from)} – ${fmtD(b.to)}, ${b.days} sessions. Every reading uses only data up to that day. P&L is the USD/TWD % move captured, added up, before costs and carry: +1 for long USD/TWD, −1 for short. Each position is held for the next session. "Same day" trades at the USD/TWD close on the day TWSE posts the flows (Yahoo's close falls after the Taipei close). "1 day late" waits one more close. Exhaustion trades one day late.`;
    $("twEp").innerHTML = D.episodes.slice().reverse().map((e) => {
      const ok = e.fwd20Pct == null ? null : e.fwd20Pct * e.side > 0;
      return `<tr><td>${esc(fmtD(e.from))}</td><td><span class="tw-tag ${e.side > 0 ? "up" : "down"}">${e.side > 0 ? "Inflows stretched" : "Outflows stretched"}</span></td><td>${e.days}</td><td>${sgn(e.C, 2)}</td><td>${e.fx0.toFixed(3)}</td><td class="${e.fwd20Pct > 0 ? "up" : e.fwd20Pct < 0 ? "down" : ""}">${e.open ? "running *" : sgn(e.fwd20Pct, 2, "%")}</td><td>${e.open ? "—" : e.fwd20Pct > 0 ? "yes" : "no"}${ok == null ? "" : ok ? " ✓" : " ✗"}</td></tr>`;
    }).join("");
  }

  // ---------- charts ----------
  const opts = () => ({ autoSize: true, localization: { locale: "en-US" }, layout: { background: { color: "transparent" }, textColor: css("--muted", "#5a6573"), fontFamily: css("--f-mono", "monospace") }, grid: { vertLines: { color: alpha(css("--line", "#d9dee5"), 0.6) }, horzLines: { color: alpha(css("--line", "#d9dee5"), 0.6) } }, rightPriceScale: { borderColor: css("--line") }, leftPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 0 }, handleScroll: false, handleScale: false });
  const leg = (el, items) => { el.innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join(""); };
  function draw() {
    if (!D || !$("twMain")) return;
    charts.forEach((c) => c.remove()); charts = [];
    const R = D.series.slice(-RNG[S.rng]);
    const up = css("--up", "#13804b"), dn = css("--down", "#c2362b"), acc = css("--accent", "#0b6fb8"), org = "#d97706", mut = css("--muted", "#5a6573");
    // 1. USD/TWD + TAIEX with exhaustion shading
    const a = LightweightCharts.createChart($("twMain"), { ...opts(), leftPriceScale: { visible: true, borderColor: css("--line") } });
    const band = a.addHistogramSeries({ priceScaleId: "reg", lastValueVisible: false, priceLineVisible: false, base: 0 });
    a.priceScale("reg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    band.setData(R.map((r) => ({ time: r[0], value: 1, color: r[10] === 1 ? alpha(up, 0.13) : r[10] === -1 ? alpha(dn, 0.1) : "rgba(0,0,0,0)" })));
    const tw = a.addLineSeries({ color: alpha(mut, 0.7), lineWidth: 1, priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    tw.setData(R.map((r) => ({ time: r[0], value: r[2] })));
    const fx = a.addLineSeries({ color: acc, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, priceFormat: { type: "price", precision: 3, minMove: 0.001 } });
    fx.setData(R.map((r) => ({ time: r[0], value: r[1] })));
    a.timeScale().fitContent(); charts.push(a);
    // 2. FINI daily net buy
    const f = LightweightCharts.createChart($("twFlow"), opts());
    const bars = f.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    bars.setData(R.map((r) => ({ time: r[0], value: r[3], color: r[3] >= 0 ? alpha(up, 0.7) : alpha(dn, 0.7) })));
    const c20 = f.addLineSeries({ color: org, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    c20.setData(R.filter((r) => r[11] != null).map((r) => ({ time: r[0], value: r[11] / 10 })));
    f.timeScale().fitContent(); charts.push(f);
    leg($("twMainLeg"), [[acc, "USD/TWD (right)"], [alpha(mut, 0.7), "TAIEX (left)"], [alpha(up, 0.5), "Inflows stretched"], [alpha(dn, 0.4), "Outflows stretched"], [up, "FINI net buy"], [dn, "FINI net sell"], [org, "FINI 20-day total ÷ 10"]]);
    // 3. signals
    const s = LightweightCharts.createChart($("twSig"), opts());
    const pA = s.addLineSeries({ color: acc, lineWidth: 1, priceLineVisible: false });
    pA.setData(R.filter((r) => r[7] != null).map((r) => ({ time: r[0], value: r[7] })));
    const pC = s.addLineSeries({ color: org, lineWidth: 2, priceLineVisible: false });
    pC.setData(R.filter((r) => r[8] != null).map((r) => ({ time: r[0], value: r[8] })));
    for (const [v, c] of [[0.5, alpha(acc, 0.5)], [-0.5, alpha(acc, 0.5)], [1, alpha(org, 0.6)], [-1, alpha(org, 0.6)]]) pC.createPriceLine({ price: v, color: c, lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    s.timeScale().fitContent(); charts.push(s);
    leg($("twSigLeg"), [[acc, `Flow pressure ${sgn(D.latest.A, 2)} (±0.5)`], [org, `Flow exhaustion ${sgn(D.latest.C, 2)} (±1)`]]);
    // 4. back-test curves
    const k = LightweightCharts.createChart($("twBt"), opts());
    const cols = [[1, acc, "Pressure, same day"], [2, alpha(acc, 0.45), "Pressure, 1 day late"], [4, org, "Exhaustion, long only"], [5, mut, "Always long USD/TWD"]];
    for (const [i, c] of cols) { const l = k.addLineSeries({ color: c, lineWidth: i === 2 ? 1 : 2, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", formatter: (v) => sgn(v, 1, "%") } }); l.setData(D.curve.map((r) => ({ time: r[0], value: r[i] }))); }
    k.timeScale().fitContent(); charts.push(k);
    leg($("twBtLeg"), cols.map(([i, c, t]) => [c, `${t} ${sgn(D.curve.at(-1)[i], 1, "%")}`]));
  }
})();
