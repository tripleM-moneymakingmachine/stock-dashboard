// China tab "CNY fxswap implied rates": the CNY rate implied by the onshore USD.CNY FX swap curve (covered interest
// parity against US Treasury bills), its term structure today vs 1W / 1M ago, Shibor and the basis, and history by tenor.
// Reads ../data/cny-fxswap.json (written by scripts/fetch-cny-fxswap.mjs, daily in cny-fxswap.yml).
(() => {
  const SRC = "../data/cny-fxswap.json";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const f = (v, n = 2) => (v == null || !isFinite(v) ? "–" : (+v).toFixed(n));
  const sg = (v, n = 1) => (v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(+v).toFixed(n)}`);
  const cls = (v) => (v == null || !isFinite(v) || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down");
  const MO = { "1W": 0.25, "2W": 0.5, "1M": 1, "2M": 2, "3M": 3, "4M": 4, "5M": 5, "6M": 6, "9M": 9, "1Y": 12 };
  const COL = { "1M": "--c1", "2M": "--c2", "3M": "--c3", "6M": "--c4", "9M": "--c5", "1Y": "--c6" };
  const MODES = [["impl", "Implied CNY %"], ["basis", "Basis to Shibor (bp)"], ["pips", "Swap points"], ["cmp", "Implied vs Shibor vs USD"]];
  const RNG = [["1M", 31], ["3M", 92], ["6M", 183], ["1Y", 366], ["All", 0]];
  let D = null, ch = null, ser = [], legs = [];
  const st = { ten: new Set(["1M", "3M", "6M", "1Y"]), mode: "impl", rng: 183, one: "3M" };

  const daysAgo = (s, n) => { if (!s?.length) return null; const cut = new Date(Date.parse(s.at(-1)[0]) - n * 864e5).toISOString().slice(0, 10); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= cut) return s[i]; return null; };
  const chg = (s, n) => { const a = s?.at(-1), b = daysAgo(s, n); return a && b ? (a[1] - b[1]) * 100 : null; };
  const back = (t, n) => daysAgo(D.series[t], n)?.[1] ?? null;

  function table() {
    const rows = D.curve?.rows || [];
    $("fsTab").innerHTML = rows.map((r) => {
      const s = D.series[r.t];
      const td = (v) => `<td class="${cls(v)}">${sg(v)}</td>`;
      return `<tr><td>${r.t}</td><td><b>${f(r.impl, 3)}</b></td>${td(chg(s, 1))}${td(chg(s, 7))}${td(chg(s, 30))}<td>${f(r.shibor, 3)}</td><td class="${cls(r.basis)}">${sg(r.basis)}</td><td>${f(r.usd, 3)}</td><td>${f(r.pips, 1)}</td></tr>`;
    }).join("");
  }

  function curve() {
    const svg = $("fscv"), W = Math.max(300, svg.clientWidth || 600), Hh = 320, P = { l: 44, r: 12, t: 12, b: 28 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const rows = (D.curve?.rows || []).filter((r) => r.impl != null);
    const now = rows.map((r) => [MO[r.t], r.impl, r]);
    const sh = rows.filter((r) => r.shibor != null).map((r) => [MO[r.t], r.shibor]);
    const us = rows.filter((r) => r.usd != null).map((r) => [MO[r.t], r.usd]);
    const old = (n) => rows.map((r) => [MO[r.t], back(r.t, n)]).filter(([, y]) => y != null);
    const w1 = old(7), m1 = old(30);
    const ys = [...now, ...sh, ...w1, ...m1, ...(st.showUsd ? us : [])].map((p) => p[1]);
    if (!ys.length) { svg.innerHTML = ""; return; }
    let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.1 || 0.1; lo -= pad; hi += pad;
    const X = (m) => P.l + m / 12 * (W - P.l - P.r), Y = (y) => P.t + (hi - y) / (hi - lo) * (Hh - P.t - P.b);
    const line = (pts, col, w, dash = "") => pts.length > 1 ? `<polyline points="${pts.map(([m, y]) => `${X(m).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>` : "";
    let g = "";
    const span = hi - lo, step = span > 2 ? 0.5 : span > 1 ? 0.25 : span > 0.4 ? 0.1 : 0.05;
    for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${Y(y) + 3.5}" text-anchor="end">${y.toFixed(2)}</text>`;
    for (const [l, m] of [["1M", 1], ["2M", 2], ["3M", 3], ["6M", 6], ["9M", 9], ["1Y", 12]]) g += `<text x="${X(m)}" y="${Hh - 8}" text-anchor="middle">${l}</text>`;
    g += line(m1, "var(--c3)", 1.4, "4 3") + line(w1, "var(--c2)", 1.4, "4 3") + line(sh, "var(--c4)", 1.6, "1 3");
    if (st.showUsd) g += line(us, "var(--c6)", 1.4, "6 3");
    g += line(now, "var(--c1)", 2.4) + now.map(([m, y]) => `<circle cx="${X(m).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.8" fill="var(--c1)"/>`).join("");
    g += `<line id="fscvX" y1="${P.t}" y2="${Hh - P.b}" stroke="var(--muted)" stroke-dasharray="2 3" visibility="hidden"/>`;
    svg.innerHTML = g;
    const tip = $("fsTip"), vx = svg.querySelector("#fscvX");
    const leave = () => { tip.hidden = true; vx.setAttribute("visibility", "hidden"); };
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W / r.width;
      if (sx < P.l - 4 || sx > W - P.r + 4) return leave();
      let best = null, bd = 1e9; for (const p of now) { const d = Math.abs(X(p[0]) - sx); if (d < bd) { bd = d; best = p; } }
      if (!best) return leave();
      const x = best[2], px = X(best[0]);
      vx.setAttribute("x1", px); vx.setAttribute("x2", px); vx.setAttribute("visibility", "visible");
      tip.innerHTML = `<b>${x.t}</b> · value ${esc(x.n)}d<br>Implied CNY <b>${f(x.impl, 3)}%</b><br>1W ago ${f(back(x.t, 7), 3)}% · 1M ago ${f(back(x.t, 30), 3)}%<br>Shibor ${f(x.shibor, 3)}% · basis <span class="${cls(x.basis)}">${sg(x.basis)} bp</span><br>UST ${f(x.usd, 3)}% · points ${f(x.pips, 1)} · fwd ${f(x.fwd, 4)}`;
      tip.hidden = false;
      const left = px * r.width / W;
      tip.style.left = Math.min(Math.max(0, left + 12), r.width - tip.offsetWidth) + "px";
      tip.style.top = Math.max(0, Y(best[1]) * r.height / Hh - tip.offsetHeight - 10) + "px";
    };
    svg.onpointermove = move; svg.onpointerdown = move; svg.onpointerleave = leave;
  }

  // ---------- history ----------
  const cut = (s) => { if (!st.rng || !s.length) return s; const c = new Date(Date.parse(s.at(-1)[0]) - st.rng * 864e5).toISOString().slice(0, 10); return s.filter(([d]) => d >= c); };
  function buildLegs() {
    if (st.mode === "cmp") {
      const s = cut(D.series[st.one] || []);
      return [
        { label: `${st.one} implied CNY`, col: css("--c1"), u: "%", data: s.map((r) => [r[0], r[1]]) },
        { label: `${st.one} Shibor`, col: css("--c4"), u: "%", data: s.filter((r) => r[4] != null).map((r) => [r[0], r[4]]) },
        { label: `${st.one} UST (USD leg)`, col: css("--c6"), u: "%", data: s.filter((r) => r[3] != null).map((r) => [r[0], r[3]]) },
      ];
    }
    return D.key.filter((t) => st.ten.has(t)).map((t) => {
      const s = cut(D.series[t] || []);
      const data = st.mode === "impl" ? s.map((r) => [r[0], r[1]]) : st.mode === "pips" ? s.map((r) => [r[0], r[2]]) : s.filter((r) => r[4] != null).map((r) => [r[0], Math.round((r[1] - r[4]) * 1000) / 10]);
      return { label: t, col: css(COL[t]), u: st.mode === "impl" ? "%" : st.mode === "pips" ? "pips" : "bp", data };
    });
  }
  const fmt = (v, u) => (u === "%" ? f(v, 3) + "%" : u === "bp" ? sg(v) + " bp" : f(v, 1));
  function legend(k) {
    $("fsLeg").innerHTML = legs.map((l) => { const v = k ? l.data.find(([d]) => d === k) : l.data.at(-1); const a = l.data[0]; const dd = v && a ? v[1] - a[1] : null; const dch = l.u === "%" ? (dd == null ? "" : ` <span class="${cls(dd * 100)}">${sg(dd * 100)} bp</span>`) : l.u === "bp" ? (dd == null ? "" : ` <span class="mut">${sg(dd)} bp</span>`) : ""; return `<span><i style="background:${l.col};height:2.5px"></i>${esc(l.label)} <b>${v ? fmt(v[1], l.u) : "–"}</b><span class="mut">${v ? " " + v[0] : ""}</span>${k ? "" : dch}</span>`; }).join("") + (k ? "" : `<span class="mut">change shown over the selected range</span>`);
  }
  function hist(fit = true) {
    legs = buildLegs();
    if (!window.LightweightCharts) return;
    const o = { layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 } };
    if (!ch) {
      ch = LightweightCharts.createChart($("fsHist"), { ...o, autoSize: true, localization: { locale: "en-US" } });
      ch.subscribeCrosshairMove((p) => { const t = p?.time; legend(t ? (typeof t === "string" ? t : `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`) : null); });
    } else ch.applyOptions(o);
    ser.forEach((x) => ch.removeSeries(x));
    const pf = st.mode === "impl" || st.mode === "cmp" ? { type: "price", precision: 3, minMove: 0.001 } : { type: "price", precision: 1, minMove: 0.1 };
    ser = legs.map((l, i) => { const x = ch.addLineSeries({ color: l.col, lineWidth: 2, priceLineVisible: false, priceFormat: pf }); x.setData(l.data.map(([time, value]) => ({ time, value }))); if (!i && st.mode === "basis") x.createPriceLine({ price: 0, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" }); return x; });
    if (fit) ch.timeScale().fitContent();
    legend(null);
  }

  function controls() {
    $("fsMode").innerHTML = MODES.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === st.mode}">${l}</button>`).join("");
    $("fsMode").querySelectorAll("button").forEach((b) => b.onclick = () => { st.mode = b.dataset.k; controls(); hist(); });
    const cmp = st.mode === "cmp";
    $("fsTen").innerHTML = D.key.map((t) => `<button type="button" data-t="${t}" aria-pressed="${cmp ? t === st.one : st.ten.has(t)}">${t}</button>`).join("");
    $("fsTen").setAttribute("aria-label", cmp ? "Tenor" : "Tenors shown (choose several)");
    $("fsTen").querySelectorAll("button").forEach((b) => b.onclick = () => {
      const t = b.dataset.t;
      if (st.mode === "cmp") st.one = t; else if (st.ten.has(t)) { if (st.ten.size > 1) st.ten.delete(t); } else st.ten.add(t);
      controls(); hist();
    });
    $("fsRng").innerHTML = RNG.map(([l, n]) => `<button type="button" data-n="${n}" aria-pressed="${n === st.rng}">${l}</button>`).join("");
    $("fsRng").querySelectorAll("button").forEach((b) => b.onclick = () => { st.rng = +b.dataset.n; controls(); hist(); });
  }

  function stamp() {
    const c = D.curve, r3 = c?.rows?.find((r) => r.t === "3M"), r1y = c?.rows?.find((r) => r.t === "1Y");
    const first = D.series["3M"]?.[0]?.[0];
    $("fsStamp").innerHTML = `<span><b>Last updated</b> ${esc(new Date(D.updated).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }))} SGT</span><span><b>Curve date</b> ${esc(c?.date || "–")}</span><span><b>Spot</b> ${f(c?.rows?.[0]?.spot, 4)}</span><span><b>3M implied</b> ${f(r3?.impl, 3)}% <span class="${cls(r3?.basis)}">(${sg(r3?.basis)} bp vs Shibor)</span></span><span><b>1Y implied</b> ${f(r1y?.impl, 3)}%</span><span><b>History</b> ${esc(first || "–")} → ${esc(c?.date || "–")}</span>`;
    $("fsNow").textContent = c?.date ? `Implied CNY ${c.date}` : "Latest";
    $("fsNote").innerHTML = `Implied CNY = ((F ÷ S) × (1 + r<sub>USD</sub> × d/360) − 1) × 360/d, simple ACT/360, where S is CFETS's mean OTC spot quote, F = S + swap points ÷ 10,000 from CFETS's USD.CNY FX swap curve (published ~16:30 Beijing), d is days from spot (T+2) to the forward value date, and r<sub>USD</sub> is the US Treasury bill par yield at that term (converted to ACT/360; UST date ${esc(c?.ustDate || "–")}). Basis = implied CNY − Shibor at the same tenor: negative means the swap market prices onshore CNY funding below Shibor (cheap CNY / rich USD via swaps), positive means CNY is dear in the swap market. Dashed lines: 1 week and 1 month earlier; dotted: Shibor. Using bills for the USD leg puts implied CNY a few bp off a SOFR-based figure; use the basis and the changes rather than the exact level.`;
  }

  async function init() {
    if (!$("fxswap")) return;
    try {
      const r = await fetch(SRC + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      D = await r.json();
      if (!D?.curve?.rows?.length) throw new Error("empty");
    } catch {
      $("fsStamp").textContent = "CNY fxswap implied rates not built yet — they are added on the next daily China refresh (18:45 SGT).";
      return;
    }
    $("fsUsd").onchange = (e) => { st.showUsd = e.target.checked; curve(); };
    stamp(); table(); curve(); controls(); hist();
    let rw; addEventListener("resize", () => { clearTimeout(rw); rw = setTimeout(curve, 150); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { curve(); hist(false); });
  }
  init();
})();
