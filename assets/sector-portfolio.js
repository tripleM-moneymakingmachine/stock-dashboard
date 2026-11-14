/* Portfolio tab: renders data/sector-portfolio.json (built after every US close by
   scripts/sector-portfolio.py): KPIs, rationale, holdings and the rebalance at the latest close,
   the sector-winner check, daily commentary, growth and drawdown charts (Lightweight Charts),
   selloffs, semis-weight choice, sector candidates, earnings, correlations and the rebalance log. */
(function () {
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const pct = (x, d = 1) => (x == null || isNaN(x) ? "—" : (x * 100).toFixed(d).replace("-", "−") + "%");
  const spct = (x, d = 1) => (x == null || isNaN(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(d) + "%");
  const num = (x, d = 2) => (x == null || isNaN(x) ? "—" : x.toFixed(d).replace("-", "−"));
  const cls = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fd = (s, y = true) => { if (!s) return "—"; const [Y, M, D] = s.split("-").map(Number); return `${MON[M - 1]} ${D}${y ? ", " + Y : ""}`; };
  const fdw = (s) => { const [Y, M, D] = s.split("-").map(Number); const w = new Date(Date.UTC(Y, M - 1, D)).getUTCDay(); return `${WD[w]} ${MON[M - 1]} ${D}`; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let D;
  const nm = (t) => (D.names && D.names[t]) || t;
  const tk = (t) => (D.folders && D.folders[t] ? `<a href="../${D.folders[t]}/">${esc(t)}</a>` : esc(t));

  fetch("../data/sector-portfolio.json?t=" + Date.now()).then((r) => r.json()).then((d) => {
    D = d;
    kpis(); why(); holdings(); next(); check(); daily(); charts(); selloffs(); weights(); cands(); earnings(); corr(); log(); rules();
    const gen = d.generated ? new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(d.generated)) + " SGT" : "";
    $("foot").textContent = `Track record from ${fd(d.start)} to the ${fd(d.updated)} close, on dividend-adjusted prices, after 0.10% trading costs. Last rebuilt ${gen}. The record before Nov 14, 2026 is a backtest; the holdings were chosen with data from that period, so it flatters the method (see "How it works"). Rules-based model output, not financial advice.`;
  }).catch((e) => { $("kpi").innerHTML = `<p class="note">Portfolio data not available yet (${esc(e.message)}).</p>`; });

  function tile(label, v, sub, c = "", hl = false) {
    return `<div class="tile${hl ? " hl" : ""}"><b>${label}</b><span class="v ${c}">${v}</span><small>${sub}</small></div>`;
  }
  function kpis() {
    const s = D.stats, p = s.port;
    $("kpi").innerHTML =
      tile("Total return", spct(p.total, 0), `Since ${fd(D.start)}. Nasdaq ${spct(s.ndx.total, 0)} · S&amp;P 500 ${spct(s.spy.total, 0)}`, cls(p.total)) +
      tile("Annual return", spct(p.cagr, 0), `Compounded. Nasdaq ${spct(s.ndx.cagr, 0)} · S&amp;P 500 ${spct(s.spy.cagr, 0)}`, cls(p.cagr)) +
      tile("Sharpe ratio", num(p.sharpe), `Excess return per unit of risk. Nasdaq ${num(s.ndx.sharpe)} · S&amp;P 500 ${num(s.spy.sharpe)}`) +
      tile("Sortino ratio", num(p.sortino), `Counts only downside swings. Nasdaq ${num(s.ndx.sortino)} · S&amp;P 500 ${num(s.spy.sortino)}`) +
      tile("Max drawdown", pct(p.maxdd), `Deepest fall from a high. Nasdaq ${pct(s.ndx.maxdd)} · ${esc(D.hold.Semis)} alone ${pct(s.semi.maxdd)}`, "neg", true) +
      tile("From its high", pct(p.fromHigh), `Peak ${fd(p.peak)}. The Nasdaq is ${pct(s.ndx.fromHigh)} from its high`, p.fromHigh < 0 ? "neg" : "") +
      tile("Volatility", pct(p.vol, 0), `Annualized. Last 3 months ${pct(p.vol3m, 0)}; Nasdaq ${pct(s.ndx.vol, 0)}`) +
      tile("Downside capture", pct(p.downCap, 0), `Average move on Nasdaq down days per 1% the Nasdaq fell. ${esc(D.hold.Semis)} alone ${pct(s.semi.downCap, 0)}`);
  }
  function why() {
    const s = D.stats, p = s.port, semi = D.hold.Semis;
    const last = D.selloffs.length ? D.selloffs[D.selloffs.length - 1] : null;
    const neg = D.corr.t.filter((t, i) => t !== semi && D.corr.m[D.corr.t.indexOf(semi)][i] < 0);
    $("why").innerHTML = [
      `<b>The problem:</b> semiconductors carry the most upside on this dashboard but fall hardest in selloffs. ${esc(semi)} on its own fell ${pct(s.semi.maxdd)} from peak to trough and, on Nasdaq down days, lost on average ${num(s.semi.downCap)}% for every 1% the index fell.`,
      `<b>The fix:</b> an AI growth sleeve of two stocks that make money from AI in different ways: chips (${esc(semi)}) and cloud software (${esc(D.hold["Cloud & AI Software"])}), which is only ${num(D.corr.m[D.corr.t.indexOf(semi)][D.corr.t.indexOf(D.hold["Cloud & AI Software"])])} correlated with ${esc(semi)}. Around it sit five stocks from different sectors that fall much less than tech in a selloff, and sometimes rise. Each reacts to a different risk: drug demand (${esc(D.hold.Healthcare)}), everyday spending (${esc(D.hold["Consumer Staples"])}), oil prices (${esc(D.hold.Energy)}), payments and rates (${esc(D.hold.Financials)}) and the jet-engine aftermarket (${esc(D.hold["Industrials / Aerospace"])}). ${neg.length ? `${neg.join(", ")} moved opposite to ${esc(semi)} on average.` : ""}`,
      `<b>How winners are picked:</b> in each sector, the stock with the best risk-adjusted return that also fell least on Nasdaq down days, confirmed by its latest quarterly results. A challenger replaces a holding only if it passes all four tests below.`,
      `<b>Sizing:</b> ${pct(D.sectors.Semis.weight, 0)} in the semi and ${pct(D.sectors["Cloud & AI Software"].weight, 0)} in cloud software, so ${pct(D.sectors.Semis.weight + D.sectors["Cloud & AI Software"].weight, 0)} rides on AI, and ${pct(D.sectors.Healthcare.weight, 0)} in each of the five defensive sectors. Raising the semi to 50% removes most of the protection (see "Choosing the semis weight").`,
      `<b>Result so far:</b> ${spct(p.total, 0)} since ${fd(D.start)} against ${spct(s.ndx.total, 0)} for the Nasdaq, with a worst drawdown of ${pct(p.maxdd)} against ${pct(s.ndx.maxdd)}.${last ? ` In the latest Nasdaq selloff (${fd(last.from, false)} to ${fd(last.to, false)}) it returned ${spct(last.port)} against ${spct(last.ndx)} for the Nasdaq.` : ""} It is now ${pct(p.fromHigh)} from its high, the Nasdaq ${pct(s.ndx.fromHigh)}.`,
    ].map((x) => `<li>${x}</li>`).join("");
  }
  function holdings() {
    const last = D.rebalances.find((r) => r.kind !== "quarterly" || true);
    $("nowSub").textContent = `Weights after the latest rebalance (${fd(D.rebalances[0].d)}, ${D.rebalances[0].kind}); "Now" is each weight after prices have moved since then. Sector rank is out of the candidates tested in that sector over the last 12 months.`;
    let h = `<table class="st"><thead><tr><th>Stock</th><th class="r">Target</th><th class="r">Now</th><th>Held since</th><th class="r">Since reb.</th><th class="r">6M mom.</th><th class="r">3M mom.</th><th class="r">Volatility</th><th class="r">Rank</th></tr></thead><tbody>`;
    D.holdings.forEach((x) => {
      h += `<tr><td>${tk(x.t)} ${esc(x.n)}<div class="note" style="margin:0">${esc(x.sector)}</div></td><td class="mono r">${pct(x.target)}</td><td class="mono r">${pct(x.now)}</td><td class="mono">${fd(x.since)}</td><td class="mono r ${cls(x.sinceReb)}">${spct(x.sinceReb)}</td><td class="mono r ${cls(x.mom6)}">${spct(x.mom6, 0)}</td><td class="mono r ${cls(x.mom3)}">${spct(x.mom3, 0)}</td><td class="mono r">${pct(x.vol3m, 0)}</td><td class="mono r">#${x.rank} of ${x.of}</td></tr>`;
    });
    $("hold").innerHTML = h + `</tbody></table><p class="note">Volatility is annualized over the last 3 months. "Since reb." is the price return since the last rebalance.</p>`;
  }
  function next() {
    const p = D.preview;
    const title = p.done ? `Rebalance at the ${fd(p.d)} close` : `Rebalance check at the ${fd(p.d)} close`;
    const sub = p.done ? "Done at the close; takes effect from the next session." :
      p.kind === "swap" ? "A sector check signal: the trades below are pending until recorded at a close." :
      p.kind === "drift" ? "A weight is more than 5 points from target: rebalance at the next close." :
      `No trade needed: no sector swap, and the largest drift from target is ${pct(p.maxDrift)} (band 5 points). Next scheduled rebalance: first close of next quarter.`;
    let h = `<h3>${title}</h3><p class="note" style="margin:0 0 10px">${sub}</p><table class="st"><thead><tr><th>Stock</th><th class="r">Now</th><th class="r">Would be</th><th></th></tr></thead><tbody>`;
    p.rows.forEach((r) => {
      const c = r.tag === "IN" ? "in" : r.tag === "OUT" ? "out" : r.tag === "UP" ? "up" : r.tag === "DOWN" ? "down" : "";
      h += `<tr${r.tag === "OUT" ? ' class="off"' : ""}><td>${tk(r.t)} ${esc(r.n)}</td><td class="mono r">${pct(r.now)}</td><td class="mono r">${pct(r.be)}</td><td><span class="chip ${c}">${r.tag}</span></td></tr>`;
    });
    h += `</tbody></table>`;
    if (p.why) h += `<p class="note">${esc(p.why)}</p>`;
    $("next").innerHTML = h;
  }
  function check() {
    $("chkSub").textContent = `Every candidate re-scored over the last ${D.rules.lookback} sessions at the ${fd(D.updated)} close. A challenger replaces the holding only if it passes all four tests. The bar is deliberately high: rotating winners every quarter on price data alone returned slightly less than holding in a walk-forward test.`;
    const ok = (v, extra = "") => (v === true ? `<span class="pos">✓</span>${extra}` : v === false ? `<span class="neg">✗</span>${extra}` : `<span class="note">no data</span>`);
    let h = `<table class="st"><thead><tr><th>Sector</th><th>Holding</th><th>Top scorer</th><th>1 · Top score</th><th>2 · Sharpe lead &gt; ${D.rules.sharpeMargin}</th><th>3 · Downside capture no worse</th><th>4 · Latest quarter agrees</th><th>Verdict</th></tr></thead><tbody>`;
    D.check.forEach((c) => {
      const T = c.tests, top = c.cands[0], inc = c.cands.find((x) => x.t === c.hold);
      const v = c.swap ? `<b class="pos">Swap → ${esc(c.top)}</b>` : `Keep ${esc(c.hold)}`;
      h += `<tr${c.swap ? ' class="hl"' : ""}><td>${esc(c.sector)}</td><td><b>${tk(c.hold)}</b></td><td><b>${tk(c.top)}</b></td>` +
        (T ? `<td>${ok(true)}</td><td>${ok(T.t2, ` <span class="note">(${T.sharpeLead >= 0 ? "+" : "−"}${Math.abs(T.sharpeLead).toFixed(2)})</span>`)}</td><td>${ok(T.t3, ` <span class="note">(${num(top.dcap)} vs ${num(inc.dcap)})</span>`)}</td><td>${ok(T.t4)}</td>`
          : `<td colspan="4" class="note">Holding is the top scorer</td>`) + `<td>${v}</td></tr>`;
    });
    $("check").innerHTML = h + `</tbody></table>`;
  }
  function daily() {
    const P = D.periods;
    $("per").innerHTML =
      tile(`This week (from ${fd(P.week.from, false)})`, spct(P.week.port), `Nasdaq ${spct(P.week.ndx)}`, cls(P.week.port)) +
      tile(`Last month (from ${fd(P.month.from, false)})`, spct(P.month.port), `Nasdaq ${spct(P.month.ndx)}`, cls(P.month.port)) +
      tile("Latest session", spct(D.daily[0].port, 2), `${fdw(D.daily[0].d)} · Nasdaq ${spct(D.daily[0].ndx, 2)}`, cls(D.daily[0].port));
    $("daily").innerHTML = D.daily.map((x) => `<div class="day"><div class="dh"><b class="dd">${fdw(x.d)}</b><span class="big ${cls(x.port)}">${spct(x.port, 2)}</span><span>Nasdaq <b class="${cls(x.ndx)}">${spct(x.ndx, 2)}</b></span><span>S&amp;P 500 <b class="${cls(x.spy)}">${spct(x.spy, 2)}</b></span><span>since start ${spct(x.cum)}</span></div><p>${esc(x.text)}</p>${x.ctx ? `<p class="ctx">${esc(x.ctx)}</p>` : ""}</div>`).join("");
  }
  function charts() {
    if (!window.LightweightCharts) { $("perf").innerHTML = `<p class="note">Chart library unavailable.</p>`; return; }
    const S = D.series, semi = D.hold.Semis;
    const L1 = [["port", "Portfolio", "--s-mom", 3], ["ew", "Equal weight", "--s-ew", 1.5], ["semi", semi + " alone", "--s-raw", 1.5], ["ndx", "Nasdaq", "--g9", 1.5], ["spy", "S&P 500", "--s-spy", 1.5]];
    const opts = (h) => ({ height: h, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: "JetBrains Mono, monospace" }, grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, crosshair: { mode: 1 }, handleScale: { mouseWheel: false, pinch: true }, handleScroll: { mouseWheel: false, pressedMouseMove: true } });
    const mk = (el, h) => { const c = LightweightCharts.createChart(el, { ...opts(h), width: el.clientWidth }); new ResizeObserver(() => c.applyOptions({ width: el.clientWidth })).observe(el); return c; };
    const c1 = mk($("perf"), 340), s1 = {};
    L1.forEach(([k, n, col, w]) => { s1[k] = c1.addLineSeries({ color: css(col), lineWidth: w, priceLineVisible: false, lastValueVisible: k === "port", title: "" }); s1[k].setData(S.d.map((d, i) => ({ time: d, value: S[k][i] * 100 }))); });
    c1.timeScale().fitContent();
    $("lg1").innerHTML = L1.map(([k, n, col]) => `<span><i style="background:${css(col)}"></i>${esc(n)}</span>`).join("");
    c1.subscribeCrosshairMove((p) => {
      if (!p.time) { $("ro1").innerHTML = ""; return; }
      $("ro1").innerHTML = `<span>${fd(p.time)}</span>` + L1.map(([k, n]) => { const v = p.seriesData.get(s1[k]); return v ? `<span>${esc(n)} <b>$${v.value.toFixed(1)}</b></span>` : ""; }).join("");
    });
    const L2 = [["port", "Portfolio", "--dd"], ["semi", semi + " alone", "--s-raw"], ["ndx", "Nasdaq", "--g9"]];
    const c2 = mk($("ddc"), 220), s2 = {};
    L2.forEach(([k, n, col]) => {
      s2[k] = k === "port" ? c2.addAreaSeries({ lineColor: css(col), topColor: css(col) + "55", bottomColor: css(col) + "10", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) + "%" } })
        : c2.addLineSeries({ color: css(col), lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) + "%" } });
      s2[k].setData(S.d.map((d, i) => ({ time: d, value: D.dd[k][i] * 100 })));
    });
    c2.timeScale().fitContent();
    $("lg2").innerHTML = L2.map(([k, n, col]) => `<span><i style="background:${css(col)}"></i>${esc(n)}</span>`).join("");
    c2.subscribeCrosshairMove((p) => {
      if (!p.time) { $("ro2").innerHTML = ""; return; }
      $("ro2").innerHTML = `<span>${fd(p.time)}</span>` + L2.map(([k, n]) => { const v = p.seriesData.get(s2[k]); return v ? `<span>${esc(n)} <b>${v.value.toFixed(1)}%</b></span>` : ""; }).join("");
    });
    let sync = false;
    const link = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (sync || !r) return; sync = true; b.timeScale().setVisibleLogicalRange(r); sync = false; });
    link(c1, c2); link(c2, c1);
  }
  function selloffs() {
    const semi = D.hold.Semis;
    let h = `<table class="st"><thead><tr><th>Nasdaq selloff</th><th class="r">Nasdaq</th><th class="r">S&amp;P 500</th><th class="r">${esc(semi)} alone</th><th class="r">Portfolio</th><th class="r">Equal weight</th></tr></thead><tbody>`;
    D.selloffs.slice().reverse().forEach((e) => {
      h += `<tr><td>${fd(e.from)} → ${fd(e.to)}${e.ongoing ? ` <span class="chip">not yet recovered</span>` : ""}</td>` + ["ndx", "spy", "semi", "port", "ew"].map((k) => `<td class="mono r ${cls(e[k])}">${spct(e[k])}</td>`).join("") + `</tr>`;
    });
    $("sell").innerHTML = h + `</tbody></table>`;
  }
  function weights() {
    const s = D.stats, semi = D.hold.Semis;
    const n = D.holdings.length, sw = D.sectors.Semis.weight, lab = (w) => `${semi} ${pct(w, 0)}, others ${pct((1 - w) / (n - 1), 1)}`;
    const tgt = D.holdings.filter((h) => h.sector !== "Semis").map((h) => pct(h.target, 0)).filter((v, i, a) => a.indexOf(v) === i).join("/");
    const rows = [[`Equal weight (${pct(1 / n, 1)} each)`, s.ew], [`Target: ${semi} ${pct(sw, 0)}, others ${tgt}`, s.port, true], [lab(0.5), s.heavy], [`${semi} alone`, s.semi], ["Nasdaq Composite", s.ndx], ["S&P 500 (SPY)", s.spy]];
    let h = `<table class="st"><thead><tr><th>Mix</th><th class="r">Total</th><th class="r">Annual</th><th class="r">Volatility</th><th class="r">Max DD</th><th class="r">Sharpe</th><th class="r">Down capture</th><th class="r">Up capture</th></tr></thead><tbody>`;
    rows.forEach(([n, x, hl]) => { h += `<tr${hl ? ' class="hl"' : ""}><td>${esc(n)}${hl ? " ★" : ""}</td><td class="mono r ${cls(x.total)}">${spct(x.total, 0)}</td><td class="mono r">${spct(x.cagr)}</td><td class="mono r">${pct(x.vol)}</td><td class="mono r neg">${pct(x.maxdd)}</td><td class="mono r">${num(x.sharpe)}</td><td class="mono r">${pct(x.downCap, 0)}</td><td class="mono r">${pct(x.upCap, 0)}</td></tr>`; });
    $("wt").innerHTML = h + `</tbody></table><p class="note">More semis adds return and drawdown. At 50% the portfolio falls about as much as the S&amp;P 500 on down days, so most of the protection is gone.</p>`;
  }
  function cands() {
    $("cands").innerHTML = D.check.map((c) => {
      let t = `<table class="st"><thead><tr><th>#</th><th>Stock</th><th class="r">12M</th><th class="r">Sharpe</th><th class="r">Down cap.</th><th class="r">6M</th></tr></thead><tbody>`;
      c.cands.forEach((x) => { t += `<tr${x.t === c.hold ? ' class="hl"' : ""}><td class="mono">${x.rank}</td><td>${tk(x.t)}${x.t === c.hold ? " ●" : ""}</td><td class="mono r ${cls(x.ret12)}">${spct(x.ret12, 0)}</td><td class="mono r">${num(x.sharpe)}</td><td class="mono r">${num(x.dcap)}</td><td class="mono r ${cls(x.mom6)}">${spct(x.mom6, 0)}</td></tr>`; });
      return `<div class="card"><div class="role">${esc(c.sector)} · ${esc(c.role)}</div><h3>${esc(c.hold)} · ${esc(nm(c.hold))}</h3>${t}</tbody></table></div>`;
    }).join("");
  }
  function earnings() {
    const held = new Set(Object.values(D.hold));
    const order = Object.keys(D.earnings).sort((a, b) => (held.has(b) - held.has(a)));
    let h = `<table class="st"><thead><tr><th>Stock</th><th>Revenue</th><th>EPS vs est.</th><th>Guidance</th><th>Key takeaway</th><th>Red flag</th><th>Verdict</th></tr></thead><tbody>`;
    order.forEach((t) => {
      const e = D.earnings[t];
      h += `<tr${held.has(t) ? "" : ' class="off"'}><td><b>${tk(t)}</b>${held.has(t) ? "" : " <span class='note'>(challenger)</span>"}<div class="note" style="margin:0">${esc(e.q)} · ${fd(e.date, false)}</div></td><td>${esc(e.rev)}</td><td>${esc(e.eps)}</td><td>${esc(e.guide)}</td><td>${esc(e.take)}</td><td>${esc(e.flag)}</td><td><span class="verdict ${esc(e.verdict.toLowerCase())}">${esc(e.verdict)}</span></td></tr>`;
    });
    $("earn").innerHTML = h + `</tbody></table>`;
  }
  function corr() {
    const T = D.corr.t, M = D.corr.m;
    let h = `<table class="st corr"><thead><tr><th></th>${T.map((t) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>`;
    T.forEach((a, i) => { h += `<tr><th>${esc(a)}</th>` + T.map((b, j) => i === j ? `<td class="mono">—</td>` : `<td class="mono" style="background:color-mix(in srgb,${M[i][j] > 0 ? "var(--down)" : "var(--accent)"} ${Math.round(Math.abs(M[i][j]) * 70)}%,transparent)">${num(M[i][j])}</td>`).join("") + `</tr>`; });
    $("corr").innerHTML = h + `</tbody></table>`;
  }
  function log() {
    const K = { start: "Start", swap: "Swap", drift: "Drift", quarterly: "Quarterly" };
    let h = `<table class="st"><thead><tr><th>Close</th><th>Type</th><th>Holdings after</th><th>Why</th></tr></thead><tbody>`;
    D.rebalances.forEach((r) => {
      const w = r.w ? Object.entries(r.w).map(([t, x]) => `${esc(t)} ${pct(x, 0)}`).join(" · ") : "Back to target weights";
      const why = r.why || (r.kind === "drift" ? "A weight drifted more than 5 points from target." : r.kind === "quarterly" ? "Scheduled quarterly rebalance." : "");
      h += `<tr><td class="mono">${fd(r.d)}</td><td><span class="chip${r.kind === "swap" ? " in" : ""}">${K[r.kind]}</span></td><td class="mono" style="font-weight:500">${w}</td><td style="font-size:13px">${esc(why)}</td></tr>`;
    });
    $("log").innerHTML = h + `</tbody></table>`;
  }
  function rules() {
    const R = D.rules;
    $("rules").innerHTML = [
      `One stock per sector: semiconductors and cloud & AI software (the AI growth sleeve), plus healthcare, consumer staples, energy, financials and industrials/aerospace. Targets: ${Object.entries(D.sectors).map(([k, v]) => `${esc(k)} ${pct(v.weight, 0)}`).join(", ")}.`,
      `Rebalanced back to target at the first close of each quarter, or at any close where a weight has drifted more than ${(R.driftBand * 100).toFixed(0)} points from target. Trading costs ${(R.cost * 100).toFixed(2)}% of the value traded.`,
      `Sector check after every close, over the last ${R.lookback} sessions: candidates are ranked on Sharpe ratio, 6-month momentum per unit of risk and downside capture against the Nasdaq. A challenger replaces the holding only if (1) it tops the score, (2) its Sharpe beats the holding's by more than ${R.sharpeMargin}, (3) its downside capture is no worse, and (4) its latest quarter agrees: it beat consensus, and either the holding missed or the challenger's EPS grew at least as fast.`,
      `Swaps take effect at the close they are recorded and show in the rebalance log. Prices are dividend-adjusted, so dividends are reinvested.`,
      D.study ? esc(D.study.text) : "",
      `Caveats: the candidate list is limited (no utilities, no LLY, no AVGO or MU), so a better sector winner may exist outside it. Energy is the least stable leg: its recent gains came from an oil and refining spike. A backtest describes the past, not the future.`,
    ].filter(Boolean).map((x) => `<li>${x}</li>`).join("");
  }
})();
