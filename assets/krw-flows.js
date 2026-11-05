/* FX tab: "USD/KRW · Korea equity flow signal". Sister of assets/twd-flows.js.
   Foreign investors' net buying of KOSPI shares (÷ KOSPI turnover) and the KOSPI against USD/KRW, two back-tested
   readings (flow pressure, 1–2 days; flow exhaustion, ~1 month), a dollar & yuan beta model that splits the won's move
   into global and Korea-specific parts, pension and retail flows, and the research write-up. Data: data/krw-flows.json,
   built by scripts/fetch-krw-flows.mjs + scripts/krw-signal.mjs (workflow krw-flows.yml, after each Seoul close).
   `notes` (the daily expert read) is kept across rebuilds; `auto` is regenerated from the back-test each build and used
   for anything `notes` doesn't cover. Styles are shared with the USD/TWD panel (.tw). */
(function () {
  const box = document.getElementById("krw");
  if (!box || !window.LightweightCharts) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  const alpha = (hex, a) => { const h = hex.replace("#", ""); if (h.length !== 6) return hex; const n = parseInt(h, 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const sgn = (v, d = 1, u = "") => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + u;
  const pc = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
  const fmtD = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (!document.getElementById("tw-css")) { const st = document.createElement("style"); st.id = "tw-css"; st.textContent = `
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
.tw .stats small{display:block;font:500 11px var(--f-mono);color:var(--muted);margin-top:2px;line-height:1.4}
.kr-att{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 10px}
@media (max-width:860px){.kr-att{grid-template-columns:repeat(2,minmax(0,1fr))}}
.kr-att>div{border:1px solid var(--line);border-radius:6px;padding:10px 12px;background:var(--panel);min-width:0}
.kr-att b{display:block;font:600 11px var(--f-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.kr-att .v{display:block;font:600 18px var(--f-mono);font-variant-numeric:tabular-nums;margin:4px 0}
.kr-att small{display:block;font:500 11px var(--f-mono);color:var(--muted)}
.kr-bar{display:flex;height:10px;border-radius:3px;overflow:hidden;background:var(--line);margin-top:6px}`; document.head.appendChild(st); }

  const RNG = { "6M": 126, "1Y": 252, "2Y": 504, All: 9999 };
  const S = { rng: "1Y" };
  try { S.rng = localStorage.getItem("krw-rng") || S.rng; } catch (e) {}
  let D, N, charts = [];
  const $ = (id) => document.getElementById(id);

  fetch("../data/krw-flows.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d || !d.series?.length || !d.backtest) return;
    D = d; N = { ...(d.auto || {}), ...(d.notes || {}) }; box.hidden = false;
    if (d.noFlows) { macro(); draw(); } else { shell(); top(); story(); bt(); draw(); }
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
  });

  function shell() {
    box.innerHTML = `
    <div class="eyebrow">USD/KRW · Korea equity flows · daily</div>
    <h2 id="krH">USD/KRW: Korea equity flow signal</h2>
    <p class="sub">Does foreign money moving in and out of Korean stocks drive the won, and does it tell you where USD/KRW goes next? This panel tracks foreign investors' daily net buying of KOSPI shares, scaled by KOSPI turnover, and the KOSPI against USD/KRW. It turns them into two signals, back-tested over the last two years using only data available at the time, and separates the part of the won's move that comes from the global dollar and the yuan from the Korea-specific part where equity flows should show. Positive readings point to a higher USD/KRW, meaning a weaker won.</p>
    <p class="tw-head" id="krHead"></p>
    <div class="tw-top" id="krTop"></div>
    <div class="tw-comp" id="krComp"></div>
    <div class="tw-grid">
      <div class="panel">
        <div class="chead"><h3>USD/KRW vs foreign net buying</h3><div class="btns" id="krRng" role="group" aria-label="Range"></div></div>
        <div id="krMain" style="height:300px"></div>
        <div id="krFlow" style="height:150px;border-top:1px dashed var(--line);margin-top:4px"></div>
        <div class="leg" id="krMainLeg"></div>
        <p class="note">Top: USD/KRW (right axis) and KOSPI (left axis). Shading marks the flow-exhaustion regime: green when inflows are stretched, red when outflows are stretched. Bottom: foreign net buy of KOSPI shares, KRW tn per day (red = net selling); the orange line is the 20-day total ÷ 10 and the purple line the pension funds' (mostly the NPS) 20-day total ÷ 10.</p>
      </div>
      <div class="panel">
        <div class="chead"><h3>Dollar, yuan or Korea? What moved USD/KRW</h3></div>
        <div class="kr-att" id="krAtt"></div>
        <div id="krAttC" style="height:200px"></div>
        <div class="leg" id="krAttLeg"></div>
        <p class="note" id="krAttNote"></p>
      </div>
      <div class="panel">
        <div class="chead"><h3>Signals</h3></div>
        <div id="krSig" style="height:200px"></div>
        <div class="leg" id="krSigLeg"></div>
        <p class="note"><b>Flow pressure</b> = −average of z-scores of foreign net buying ÷ KOSPI turnover over 1 and 5 days. At +0.5 or above, foreigners are selling hard, which leans long USD/KRW for 1–2 days; at −0.5 or below they are buying, which leans short. <b>Flow exhaustion</b> = average of z-scores of foreign net ÷ turnover over 20 days and the KOSPI 20-day return. At ±1 a month of flows is stretched; whether that has paid is in the back-test below. Each z-score is against the trailing 250 sessions only.</p>
      </div>
      <div class="tw-two">
        <div class="panel tw-now" id="krNow"></div>
        <div class="panel"><h3 style="font:600 17px var(--f-body);margin:0 0 8px">What the research found</h3><ul class="tw-f" id="krFind"></ul></div>
      </div>
      <div class="panel">
        <div class="chead"><h3>Back-test, last two years</h3></div>
        <div class="stats" id="krStats"></div>
        <div id="krBt" style="height:240px;margin-top:12px"></div>
        <div class="leg" id="krBtLeg"></div>
        <p class="note" id="krBtNote"></p>
        <div style="overflow-x:auto;margin-top:12px"><table class="tw-ep" aria-label="Flow exhaustion episodes"><thead><tr><th>From</th><th>Regime</th><th>Days</th><th>Reading</th><th>USD/KRW</th><th>Next 20d</th><th>Korea-specific</th><th>Won weaker?</th></tr></thead><tbody id="krEp"></tbody></table></div>
        <p class="note">Flow-exhaustion episodes, newest first. "Next 20d" is the USD/KRW change over the 20 sessions after the episode started; "Korea-specific" is the same move with the dollar and yuan parts taken out. ✓ marks a move in the direction the regime points to. * still running.</p>
        <p class="note" id="krCav"></p>
      </div>
    </div>`;
    $("krRng").innerHTML = Object.keys(RNG).map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === S.rng}">${k}</button>`).join("");
    $("krRng").onclick = (e) => { const k = e.target.dataset?.k; if (!k) return; S.rng = k; try { localStorage.setItem("krw-rng", k); } catch (x) {} $("krRng").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k)); draw(); };
  }

  // Macro-only mode (no KOSPI investor-flow history yet): USD/KRW vs KOSPI and the dollar/yuan/Korea split
  function macro() {
    const L = D.latest, b = D.backtest, m = b.model;
    box.innerHTML = `
    <div class="eyebrow">USD/KRW · Korea equity flows · daily</div>
    <h2 id="krH">USD/KRW: Korea equity flow signal</h2>
    <p class="sub">What is driving the won: the global dollar, the yuan, or something Korea-specific such as foreign equity flows? The dollar and yuan split below is live. The foreign-flow signals and their back-test switch on once KOSPI investor-flow history is connected.</p>
    <div class="tw-chip warn" style="margin:0 0 12px"><b>Flow signals · pending data</b><span>Foreign-flow history not connected yet</span><small>KRX has required a member login for its investor statistics since Dec 2025. Once the KRX_ID / KRX_PW repository secrets are set, the next run back-fills about three years and this panel switches to the full flow signal and back-test.</small></div>
    <div class="tw-comp" id="krComp"></div>
    <div class="tw-grid">
      <div class="panel">
        <div class="chead"><h3>Dollar, yuan or Korea? What moved USD/KRW</h3></div>
        <div class="kr-att" id="krAtt"></div>
        <div id="krAttC" style="height:220px"></div>
        <div class="leg" id="krAttLeg"></div>
        <p class="note" id="krAttNote"></p>
      </div>
      <div class="panel">
        <div class="chead"><h3>USD/KRW vs KOSPI</h3><div class="btns" id="krRng" role="group" aria-label="Range"></div></div>
        <div id="krMain" style="height:300px"></div>
        <div class="leg" id="krMainLeg"></div>
        <div class="stats" id="krStats" style="margin-top:12px"></div>
        <p class="note">${esc(fmtD(b.from))} – ${esc(fmtD(b.to))}, non-overlapping 5-day windows. "Korea-specific" is the USD/KRW move left after the dollar index and USD/CNH parts at the rolling betas. A negative KOSPI link means a rising KOSPI goes with a stronger won.</p>
      </div>
    </div>`;
    $("krRng").innerHTML = Object.keys(RNG).map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === S.rng}">${k}</button>`).join("");
    $("krRng").onclick = (e) => { const k = e.target.dataset?.k; if (!k) return; S.rng = k; try { localStorage.setItem("krw-rng", k); } catch (x) {} $("krRng").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.k === k)); draw(); };
    const tone = (v) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
    $("krComp").innerHTML = [
      ["USD/KRW", "20-day change", sgn(L.fx20, 1, "%"), `${L.fx.toFixed(1)} · + = won weaker`, -L.fx20],
      ["KOSPI", "20-day change", sgn(L.eq20, 1, "%"), Math.round(L.kospi).toLocaleString("en-US"), L.eq20],
      ["Dollar index", "20-day change", sgn(L.dx20, 1, "%"), L.dx?.toFixed(2), -L.dx20],
      ["USD/CNH", "20-day change", sgn(L.cn20, 1, "%"), L.cnh?.toFixed(4), -L.cn20],
    ].map(([t, s, v, x, c]) => `<div><b>${esc(t)}</b><small>${esc(s)}</small><span class="v ${tone(c)}">${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
    attTiles();
    $("krStats").innerHTML = [
      ["Dollar link", sgn(b.dxy5dCorr, 2), "corr, 5-day DXY vs USD/KRW"],
      ["Yuan link", sgn(b.cnh5dCorr, 2), "corr, 5-day USD/CNH vs USD/KRW"],
      ["KOSPI link", sgn(b.kospi5dCorr, 2), "corr, 5-day KOSPI vs USD/KRW"],
      ["KOSPI → Korea-specific", sgn(b.kospi5dCorrKorea, 2), "corr, 5-day KOSPI vs the Korea part"],
      ["Model fit", m.r2 == null ? "—" : Math.round(m.r2 * 100) + "%", `of daily moves · β DXY ${sgn(m.betaDxy, 2)} · β CNH ${sgn(m.betaCnh, 2)}`],
    ].map(([t, v, x]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
  }
  function attTiles() {
    const L = D.latest, m = D.backtest.model, a = L.att;
    if (a) {
      const parts = [["dx", "Dollar index", css("--accent", "#0b6fb8")], ["cn", "Yuan (USD/CNH)", "#d97706"], ["kr", "Korea-specific", "#7c3aed"]];
      const tot = Math.abs(a.dx) + Math.abs(a.cn) + Math.abs(a.kr) || 1;
      $("krAtt").innerHTML = `<div><b>USD/KRW, 20 sessions</b><span class="v ${a.tot > 0 ? "up" : a.tot < 0 ? "down" : ""}">${sgn(a.tot, 2, "%")}</span><small>= the three parts →</small><div class="kr-bar">${parts.map(([k, , c]) => `<i style="width:${(Math.abs(a[k]) / tot) * 100}%;background:${c}"></i>`).join("")}</div></div>` +
        parts.map(([k, t, c]) => `<div style="border-left:3px solid ${c}"><b>${t}</b><span class="v">${sgn(a[k], 2, "%")}</span><small>${k === "dx" ? `β ${sgn(m.betaDxy, 2)} × DXY ${sgn(L.dx20, 1, "%")}` : k === "cn" ? `β ${sgn(m.betaCnh, 2)} × CNH ${sgn(L.cn20, 1, "%")}` : "what's left: flows, BoK, NPS, exporters"}</small></div>`).join("");
    }
    $("krAttNote").textContent = `Rolling ${m.window}-session regression of daily USD/KRW % changes on the dollar index and USD/CNH, estimated only on data before each day. Latest betas: ${sgn(m.betaDxy, 2)} to the dollar index and ${sgn(m.betaCnh, 2)} to USD/CNH, explaining ${m.r2 == null ? "—" : Math.round(m.r2 * 100) + "%"} of daily moves. Chart: the 20-session USD/KRW move split into those parts. A Korea-specific part that tracks foreign equity flows is the signal at work; a move that is mostly dollar or yuan is not about Korean stocks.`;
  }

  function top() {
    const L = D.latest, b = D.backtest, E = b.exhaustion.episodes;
    $("krHead").textContent = N.headline || "";
    const rec = (e) => `${e.right} of ${e.n} episodes right`;
    const pT = L.rA === 1 ? ["Selling pressure", "up", "lean long USD/KRW, next 1–2 days"] : L.rA === -1 ? ["Buying pressure", "down", "lean short USD/KRW, next 1–2 days"] : ["Neutral", "", "no 1–2 day lean"];
    const eT = L.rC === 1 ? ["Inflows stretched", E.long.n && E.long.right / E.long.n >= 0.6 ? "up" : "warn", `long USD/KRW over ~1 month · ${rec(E.long)}`] : L.rC === -1 ? ["Outflows stretched", E.short.n && E.short.right / E.short.n >= 0.6 ? "down" : "warn", `short USD/KRW over ~1 month · ${rec(E.short)}`] : ["Neutral", "", "no one-month signal"];
    $("krTop").innerHTML = `
      <div class="tw-chip ${esc(N.callTone || "")}"><b>Verdict · ${esc(N.asof || fmtD(L.date))}</b><span>${esc(N.call || "Awaiting the first daily read")}</span><small>A judgment call that combines both signals with their back-test record. Not financial advice.</small></div>
      <div class="tw-chip ${pT[1]}"><b>Flow pressure · ${esc(fmtD(L.date))}</b><span>${pT[0]}</span><em>${sgn(L.A, 2)}</em><small>${pT[2]} · threshold ±${b.pressure.threshold} · 5 sessions ago ${sgn(L.A5ago, 2)}</small></div>
      <div class="tw-chip ${eT[1]}"><b>Flow exhaustion · ${esc(fmtD(L.date))}</b><span>${eT[0]}</span><em>${sgn(L.C, 2)}</em><small>${eT[2]} · threshold ±${b.exhaustion.threshold} · 5 sessions ago ${sgn(L.C5ago, 2)}</small></div>`;
    const tone = (v) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
    $("krComp").innerHTML = [
      ["Foreign net buy", "latest session", sgn(L.net, 2, " tn"), `${sgn(L.x1, 1, "%")} of turnover · z ${sgn(L.z.x1, 2)}`, L.net],
      ["Foreign 5 days", "net buy, KRW tn", sgn(L.net5, 2, " tn"), `${sgn(L.x5, 1, "%")} of turnover · z ${sgn(L.z.x5, 2)}`, L.net5],
      ["Foreign 20 days", "net buy, KRW tn", sgn(L.net20, 1, " tn"), `${sgn(L.x20, 1, "%")} of turnover · z ${sgn(L.z.x20, 2)}`, L.net20],
      ["Foreign 60 days", "net buy, KRW tn", sgn(L.net60, 1, " tn"), "cumulative", L.net60],
      ["Pension funds 20d", "mostly the NPS", sgn(L.pen20, 1, " tn"), `today ${sgn(L.pen, 2, " tn")}`, L.pen20],
      ["Retail 20d", "individuals", sgn(L.ret20, 1, " tn"), `today ${sgn(L.retail, 2, " tn")}`, L.ret20],
      ["KOSPI", "20-day change", sgn(L.eq20, 1, "%"), `${Math.round(L.kospi).toLocaleString("en-US")} · z ${sgn(L.z.eq20, 2)}`, L.eq20],
      ["USD/KRW", "20-day change", sgn(L.fx20, 1, "%"), `${L.fx.toFixed(1)} · + = won weaker`, -L.fx20],
    ].map(([t, s, v, x, c]) => `<div><b>${esc(t)}</b><small>${esc(s)}</small><span class="v ${tone(c)}">${esc(v)}</span><small>${esc(x)}</small></div>`).join("");
    attTiles();
  }

  function story() {
    if (N.now) $("krNow").innerHTML = `<h3>Latest read <span class="mut">· ${esc(N.asof)}</span></h3><p>${esc(N.now)}</p>${N.flip ? `<p><b>What would change it.</b> ${esc(N.flip)}</p>` : ""}`;
    else $("krNow").innerHTML = `<h3>Latest read <span class="mut">· ${esc(fmtD(D.latest.date))}</span></h3><p>${esc(N.headline || "")}</p><p class="mut">The daily strategist read is written after each Seoul close; the numbers above update automatically.</p>`;
    $("krFind").innerHTML = (N.findings || []).map(([h, p]) => `<li><b>${esc(h)}</b><p>${esc(p)}</p></li>`).join("");
    $("krCav").textContent = N.caveats || "";
  }

  function bt() {
    const b = D.backtest, P = b.pressure, E = b.exhaustion;
    $("krStats").innerHTML = [
      ["Pressure, same day", `${sgn(P.sameDay.cumPct, 1, "%")}`, `Sharpe ${P.sameDay.sharpe ?? "—"} · max DD ${P.sameDay.maxDdPct}% · IC ${P.ic1.ic ?? "—"}`],
      ["Pressure, 1 day late", `${sgn(P.oneDayLate.cumPct, 1, "%")}`, `Sharpe ${P.oneDayLate.sharpe ?? "—"} · IC ${P.ic1Late.ic ?? "—"}`],
      ["Pressure, dollar-hedged", `${sgn(P.hedged.cumPct, 1, "%")}`, `Sharpe ${P.hedged.sharpe ?? "—"} · Korea-specific move only`],
      ["Pressure calls, next 2d", `${pc(P.next2d.long.hit)} / ${pc(P.next2d.short.hit)}`, `right on long / short days (${P.next2d.long.days} / ${P.next2d.short.days})`],
      ["Inflows stretched → long", `${E.episodes.long.right} of ${E.episodes.long.n}`, `episodes right · avg next 20d ${sgn(E.episodes.long.avgFwd20Pct, 2, "%")}`],
      ["Outflows stretched → short", `${E.episodes.short.right} of ${E.episodes.short.n}`, `episodes right · avg next 20d ${sgn(E.episodes.short.avgFwd20Pct, 2, "%")}`],
      ["Exhaustion, both sides", `${sgn(E.oneDayLate.cumPct, 1, "%")}`, `Sharpe ${E.oneDayLate.sharpe ?? "—"} · long-only ${sgn(E.longOnly.cumPct, 1, "%")} · short-only ${sgn(E.shortOnly.cumPct, 1, "%")}`],
      ["Always long USD/KRW", `${sgn(b.hold.cumPct, 1, "%")}`, `Sharpe ${b.hold.sharpe ?? "—"} · max DD ${b.hold.maxDdPct}%`],
      ["Same-week link", `${sgn(b.contemp5dCorr, 2)}`, `corr, 5-day flow vs USD/KRW · ${sgn(b.contemp5dCorrHedged, 2)} vs Korea-specific`],
      ["Dollar link", `${sgn(b.dxy5dCorr, 2)}`, `corr, 5-day DXY vs USD/KRW · CNH ${sgn(b.cnh5dCorr, 2)}`],
    ].map(([t, v, s]) => `<div>${esc(t)}<span>${esc(v)}</span><small>${esc(s)}</small></div>`).join("");
    $("krBtNote").textContent = `${fmtD(b.from)} – ${fmtD(b.to)}, ${b.days} sessions. Every reading uses only data up to that day. P&L is the USD/KRW % move captured, added up, before costs and carry: +1 for long USD/KRW, −1 for short, held for the next session. "Same day" trades at the USD/KRW close on the day KRX posts the flows (Yahoo's close falls after the 15:30 Seoul stock close); "1 day late" waits one more close. "Dollar-hedged" earns only the Korea-specific part of the move, as if the dollar and yuan exposure were hedged at the model betas. Exhaustion trades one day late.`;
    $("krEp").innerHTML = D.episodes.slice().reverse().map((e) => {
      const ok = e.fwd20Pct == null ? null : e.fwd20Pct * e.side > 0;
      return `<tr><td>${esc(fmtD(e.from))}</td><td><span class="tw-tag ${e.side > 0 ? "up" : "down"}">${e.side > 0 ? "Inflows stretched" : "Outflows stretched"}</span></td><td>${e.days}</td><td>${sgn(e.C, 2)}</td><td>${e.fx0.toFixed(1)}</td><td class="${e.fwd20Pct > 0 ? "up" : e.fwd20Pct < 0 ? "down" : ""}">${e.open ? "running *" : sgn(e.fwd20Pct, 2, "%")}</td><td>${e.open || e.fwd20ResPct == null ? "—" : sgn(e.fwd20ResPct, 2, "%")}</td><td>${e.open ? "—" : e.fwd20Pct > 0 ? "yes" : "no"}${ok == null ? "" : ok ? " ✓" : " ✗"}</td></tr>`;
    }).join("");
  }

  // ---------- charts ----------
  const opts = () => ({ autoSize: true, localization: { locale: "en-US" }, layout: { background: { color: "transparent" }, textColor: css("--muted", "#5a6573"), fontFamily: css("--f-mono", "monospace") }, grid: { vertLines: { color: alpha(css("--line", "#d9dee5"), 0.6) }, horzLines: { color: alpha(css("--line", "#d9dee5"), 0.6) } }, rightPriceScale: { borderColor: css("--line") }, leftPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 0 }, handleScroll: false, handleScale: false });
  const leg = (el, items) => { el.innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join(""); };
  const pctFmt = { type: "custom", formatter: (v) => sgn(v, 1, "%") };
  function attChart(R) {
    const acc = css("--accent", "#0b6fb8"), org = "#d97706", pur = "#7c3aed", mut = css("--muted", "#5a6573");
    const t = LightweightCharts.createChart($("krAttC"), opts());
    const parts = [[16, pur, "Korea-specific", 2], [14, acc, "Dollar index", 1], [15, org, "Yuan", 1]];
    const tot = t.addLineSeries({ color: alpha(mut, 0.8), lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, priceFormat: pctFmt });
    tot.setData(R.filter((r) => r[14] != null).map((r) => ({ time: r[0], value: r[14] + r[15] + r[16] })));
    for (const [i, c, , w] of parts) { const l = t.addLineSeries({ color: c, lineWidth: w, priceLineVisible: false, lastValueVisible: false, priceFormat: pctFmt }); l.setData(R.filter((r) => r[i] != null).map((r) => ({ time: r[0], value: r[i] }))); }
    t.timeScale().fitContent(); charts.push(t);
    leg($("krAttLeg"), [[alpha(mut, 0.8), "USD/KRW 20-session move"], ...parts.map(([, c, n]) => [c, n])]);
  }
  function draw() {
    if (!D || !$("krMain")) return;
    charts.forEach((c) => c.remove()); charts = [];
    const R = D.series.slice(-RNG[S.rng]);
    const up = css("--up", "#13804b"), dn = css("--down", "#c2362b"), acc = css("--accent", "#0b6fb8"), org = "#d97706", pur = "#7c3aed", mut = css("--muted", "#5a6573");
    // 1. USD/KRW + KOSPI with exhaustion shading
    const a = LightweightCharts.createChart($("krMain"), { ...opts(), leftPriceScale: { visible: true, borderColor: css("--line") } });
    const band = a.addHistogramSeries({ priceScaleId: "reg", lastValueVisible: false, priceLineVisible: false, base: 0 });
    a.priceScale("reg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    band.setData(R.map((r) => ({ time: r[0], value: 1, color: r[10] === 1 ? alpha(up, 0.13) : r[10] === -1 ? alpha(dn, 0.1) : "rgba(0,0,0,0)" })));
    const ks = a.addLineSeries({ color: alpha(mut, 0.7), lineWidth: 1, priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    ks.setData(R.map((r) => ({ time: r[0], value: r[2] })));
    const fx = a.addLineSeries({ color: acc, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, priceFormat: { type: "price", precision: 1, minMove: 0.1 } });
    fx.setData(R.map((r) => ({ time: r[0], value: r[1] })));
    a.timeScale().fitContent(); charts.push(a);
    if (D.noFlows) { leg($("krMainLeg"), [[acc, "USD/KRW (right)"], [alpha(mut, 0.7), "KOSPI (left)"]]); attChart(R); return; }
    // 2. foreign daily net buy, 20d totals
    const f = LightweightCharts.createChart($("krFlow"), opts());
    const bars = f.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    bars.setData(R.map((r) => ({ time: r[0], value: r[3], color: r[3] >= 0 ? alpha(up, 0.7) : alpha(dn, 0.7) })));
    const c20 = f.addLineSeries({ color: org, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    c20.setData(R.filter((r) => r[11] != null).map((r) => ({ time: r[0], value: r[11] / 10 })));
    const p20 = f.addLineSeries({ color: pur, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    p20.setData(R.filter((r) => r[12] != null).map((r) => ({ time: r[0], value: r[12] / 10 })));
    f.timeScale().fitContent(); charts.push(f);
    leg($("krMainLeg"), [[acc, "USD/KRW (right)"], [alpha(mut, 0.7), "KOSPI (left)"], [alpha(up, 0.5), "Inflows stretched"], [alpha(dn, 0.4), "Outflows stretched"], [up, "Foreign net buy"], [dn, "Foreign net sell"], [org, "Foreign 20-day ÷ 10"], [pur, "Pension 20-day ÷ 10"]]);
    attChart(R);
    // 4. signals
    const s = LightweightCharts.createChart($("krSig"), opts());
    const pA = s.addLineSeries({ color: acc, lineWidth: 1, priceLineVisible: false });
    pA.setData(R.filter((r) => r[7] != null).map((r) => ({ time: r[0], value: r[7] })));
    const pC = s.addLineSeries({ color: org, lineWidth: 2, priceLineVisible: false });
    pC.setData(R.filter((r) => r[8] != null).map((r) => ({ time: r[0], value: r[8] })));
    for (const [v, c] of [[0.5, alpha(acc, 0.5)], [-0.5, alpha(acc, 0.5)], [1, alpha(org, 0.6)], [-1, alpha(org, 0.6)]]) pC.createPriceLine({ price: v, color: c, lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    s.timeScale().fitContent(); charts.push(s);
    leg($("krSigLeg"), [[acc, `Flow pressure ${sgn(D.latest.A, 2)} (±0.5)`], [org, `Flow exhaustion ${sgn(D.latest.C, 2)} (±1)`]]);
    // 5. back-test curves
    const k = LightweightCharts.createChart($("krBt"), opts());
    const cols = [[1, acc, "Pressure, same day", 2], [2, alpha(acc, 0.45), "Pressure, 1 day late", 1], [3, pur, "Pressure, dollar-hedged", 2], [4, org, "Exhaustion", 2], [7, mut, "Always long USD/KRW", 1]];
    for (const [i, c, , w] of cols) { const l = k.addLineSeries({ color: c, lineWidth: w, priceLineVisible: false, lastValueVisible: false, priceFormat: pctFmt }); l.setData(D.curve.map((r) => ({ time: r[0], value: r[i] }))); }
    k.timeScale().fitContent(); charts.push(k);
    leg($("krBtLeg"), cols.map(([i, c, n]) => [c, `${n} ${sgn(D.curve.at(-1)[i], 1, "%")}`]));
  }
})();
