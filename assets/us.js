// US tab: CME Three-Month SOFR futures strip, time series, implied curve, calendar spreads, Fed pricing and
// the research view. Data: data/sofr.json (scripts/fetch-sofr.mjs), data/fedwatch.json, data/us-recap.json.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const COLS = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ms = (d) => Date.parse(d + "T00:00:00Z");
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const dShort = (d) => { const t = new Date(ms(d)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
  const dLong = (d) => { const t = new Date(ms(d)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
  const f = (v, n = 1) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(n));
  const cls = (v, inv = false) => (v == null || !isFinite(v) || Math.abs(v) < 0.05 ? "mut" : (v > 0) !== inv ? "up" : "down");
  const rcls = (v) => cls(v, true); // rate up = price down = red
  const S = { data: null, fw: null, recap: null, sel: new Set(), mode: "rate", rng: "1M", cmp: "1W", sp: null, spRng: "All", fdCmp: 5, charts: {} };

  // ---------- data access ----------
  const H = () => S.data.hist;
  const latestDate = () => H().at(-1)?.d;
  const val = (h, code) => h?.p?.[code];
  const isModel = (h, code) => !!(h?.mk || []).includes(code);
  const cur = (c) => (c.px != null ? c.px : val(H().at(-1), c.code));
  // baseline settle: last history day strictly before `before` that has this contract
  function base(code, before) {
    for (let i = H().length - 1; i >= 0; i--) { const h = H()[i]; if (h.d < before && val(h, code) != null) return { d: h.d, v: val(h, code), m: isModel(h, code) }; }
    return null;
  }
  const cuts = () => {
    const T = latestDate(), t = new Date(ms(T)), dow = (t.getUTCDay() + 6) % 7;
    return { T, dod: T, wtd: iso(ms(T) - dow * 864e5), mtd: T.slice(0, 8) + "01" };
  };
  function chg(c, key) { // bp of implied rate
    const k = cuts(), b = base(c.code, k[key]), p = cur(c);
    if (!b || p == null) return null;
    return { v: -(p - b.v) * 100, d: b.d, m: b.m };
  }
  const contract = (code) => S.data.contracts.find((c) => c.code === code);
  const sofr = () => S.data.sofr?.rate;

  // ---------- stamp ----------
  function stamp() {
    const d = S.data, qt = d.quoteTime ? new Date(d.quoteTime * 1000) : null;
    const age = qt ? (Date.now() - qt) / 6e4 : Infinity;
    const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const wd = ny.getDay(), hr = ny.getHours();
    const open = !(wd === 6 || (wd === 0 && hr < 18) || (wd === 5 && hr >= 17) || hr === 17);
    const live = open && age < 45;
    const fmt = (t, tz) => t.toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const s = d.sofr;
    $("stamp").innerHTML =
      `<span><i class="dot${live ? " on" : ""}"></i><b>${live ? "Delayed live" : open ? "Delayed" : "Market closed"}</b>${qt ? `${fmt(qt, "America/New_York")} ET · ${fmt(qt, "Asia/Singapore")} SGT` : "—"}</span>` +
      (s ? `<span><b>SOFR</b>${s.rate.toFixed(2)}% <span class="mut">(${dShort(s.d)}; 1st–99th pct ${s.p1?.toFixed(2)}–${s.p99?.toFixed(2)}%, $${Math.round(s.vol / 10) / 100}tn)</span></span>` : "") +
      `<span><b>Settles</b>${H().length} sessions from ${dShort(H()[0].d)}</span>` +
      (d.stale ? `<span class="down"><b>Feed</b>stale, showing the last good file</span>` : "");
  }

  // ---------- strip table ----------
  const GROUPS = [["Whites · year 1", 0, 4], ["Reds · year 2", 4, 8], ["Greens · year 3", 8, 12], ["Blues · year 4", 12, 16]];
  function strip() {
    const cs = S.data.contracts, s = sofr();
    const all = cs.map((c) => ({ c, d: chg(c, "dod"), w: chg(c, "wtd"), m: chg(c, "mtd") }));
    const mx = Math.max(1, ...all.map((r) => Math.abs(r.m?.v || 0)));
    let html = "", modelled = false;
    for (const [g, a, b] of GROUPS) {
      const rows = all.slice(a, b); if (!rows.length) continue;
      html += `<tr class="g"><td colspan="10">${g}</td></tr>`;
      for (const { c, d, w, m } of rows) {
        const p = cur(c), r = p != null ? 100 - p : null;
        const cell = (x, bar) => {
          if (!x) return `<td class="mut" title="no settle before this period yet">n/a</td>`;
          if (x.m) modelled = true;
          const b2 = bar ? `<span class="bar" style="width:${Math.round(Math.abs(x.v) / mx * 36)}px;background:var(${x.v > 0 ? "--down" : "--up"})"></span>` : "";
          return `<td class="${rcls(x.v)}" title="vs ${dLong(x.d)}${x.m ? " (modelled)" : ""}">${f(x.v)}${x.m ? "<sup>m</sup>" : ""}${b2}</td>`;
        };
        html += `<tr data-code="${c.code}" aria-selected="${S.sel.has(c.code)}" tabindex="0">
          <td class="code">SR3${esc(c.code)} <span class="mut">· ${esc(c.label)}</span>${c.old ? ' <span class="pill">old</span>' : ""}</td>
          <td class="mut">${dShort(c.start)} – ${dShort(c.end)}</td>
          <td>${p != null ? p.toFixed(3) : "—"}</td>
          <td><b>${r != null ? r.toFixed(3) + "%" : "—"}</b></td>
          ${cell(d)}${cell(w)}${cell(m, true)}
          <td>${r != null && s != null ? f((r - s) * 100, 1) : "—"}</td>
          <td class="mut">${c.lo != null ? `${c.lo.toFixed(3)}–${c.hi.toFixed(3)}` : "—"}</td>
          <td class="mut">${c.vol != null ? (c.vol / 1000).toFixed(0) + "k" : "—"}</td></tr>`;
      }
    }
    $("stBody").innerHTML = html;
    const k = cuts();
    $("stNote").innerHTML = `Latest session ${dLong(k.T)}. WTD base: last settle before ${dLong(k.wtd)}; MTD base: last settle before ${dLong(k.mtd)}. ` +
      (modelled ? "<sup>m</sup> = base settle modelled from the fed funds futures path (contracts beyond the ZQ horizon show n/a until real settles build up). " : "") +
      "Negative (green) = implied rate fell, price rose.";
    $("stBody").querySelectorAll("tr[data-code]").forEach((tr) => {
      const go = () => { const k2 = tr.dataset.code; if (S.sel.has(k2) && S.sel.size > 1) S.sel.delete(k2); else S.sel.add(k2); syncSel(); };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  function syncSel() {
    $("stBody").querySelectorAll("tr[data-code]").forEach((tr) => tr.setAttribute("aria-selected", S.sel.has(tr.dataset.code)));
    picks(); ts();
  }

  // ---------- buttons ----------
  function btns(el, opts, curv, on) {
    el.innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(curv)}">${l}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); on(b.dataset.v); }));
  }
  const colorOf = (code) => css(COLS[S.data.contracts.findIndex((c) => c.code === code) % COLS.length]);
  function picks() {
    const el = $("tsPick");
    el.innerHTML = S.data.contracts.map((c) => `<button type="button" data-v="${c.code}" aria-pressed="${S.sel.has(c.code)}"><i style="background:${S.sel.has(c.code) ? colorOf(c.code) : "var(--line)"}"></i>${c.code}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.v; if (S.sel.has(k) && S.sel.size > 1) S.sel.delete(k); else if (!S.sel.has(k)) { if (S.sel.size >= 6) S.sel.delete([...S.sel][0]); S.sel.add(k); }
      syncSel();
    }));
  }

  // ---------- lightweight-charts helpers ----------
  const LW = () => window.LightweightCharts;
  function mkChart(el, fmt) {
    el.innerHTML = "";
    const c = LW().createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono"), fontSize: 11 },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line"), fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 }, localization: { priceFormatter: fmt },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    return c;
  }
  // split a [{time,value,m}] list into modelled (dashed) and real (solid) series that share the hand-over point
  function addSplit(chart, pts, color, title) {
    const firstReal = pts.findIndex((p) => !p.m);
    const real = firstReal >= 0 ? pts.slice(firstReal) : [];
    const mod = firstReal > 0 ? pts.slice(0, firstReal + 1) : firstReal < 0 ? pts : [];
    const strip = (a) => a.map(({ time, value }) => ({ time, value }));
    if (mod.length) chart.addLineSeries({ color, lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true }).setData(strip(mod));
    if (real.length) chart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, title }).setData(strip(real));
  }
  const RANGES = [["1W", "1W"], ["1M", "1M"], ["3M", "3M"], ["All", "All"]];
  const rngDays = { "1W": 7, "1M": 31, "3M": 92 };
  function setRange(chart, pts, r) {
    if (!pts.length) return;
    const last = pts.at(-1).time;
    if (r === "All" || !rngDays[r]) chart.timeScale().fitContent();
    else { const from = iso(ms(last) - rngDays[r] * 864e5); chart.timeScale().setVisibleRange({ from: from < pts[0].time ? pts[0].time : from, to: last }); }
  }

  // ---------- time series ----------
  function ts() {
    if (!LW()) { $("ts").innerHTML = '<p class="empty">Chart library did not load.</p>'; return; }
    S.charts.ts?.remove?.();
    const rate = S.mode === "rate";
    const chart = mkChart($("ts"), (v) => (rate ? v.toFixed(3) + "%" : v.toFixed(3)));
    S.charts.ts = chart;
    let any = [];
    const leg = [];
    for (const code of S.sel) {
      const pts = H().filter((h) => val(h, code) != null).map((h) => ({ time: h.d, value: rate ? +(100 - val(h, code)).toFixed(4) : val(h, code), m: isModel(h, code) }));
      if (!pts.length) continue;
      addSplit(chart, pts, colorOf(code), code);
      if (pts.length > any.length) any = pts;
      const c = contract(code), last = pts.at(-1).value;
      leg.push(`<span><i style="background:${colorOf(code)}"></i>SR3${code} ${c.label}: <b>${last.toFixed(3)}${rate ? "%" : ""}</b></span>`);
    }
    if (rate && sofr() != null && any.length) {
      const fx = (S.data.sofr.hist || []).filter((x) => x[0] >= any[0].time).map((x) => ({ time: x[0], value: x[1] }));
      if (fx.length) { chart.addLineSeries({ color: css("--muted"), lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false, title: "SOFR" }).setData(fx); leg.push(`<span><i style="background:var(--muted)"></i>SOFR fixing</span>`); }
    }
    leg.push(`<span><i class="dash" style="color:var(--muted)"></i>modelled</span>`);
    $("tsLeg").innerHTML = leg.join("");
    setRange(chart, any, S.rng);
  }

  // ---------- SVG helpers ----------
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, a, parent) { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); parent?.appendChild(e); return e; }
  function niceTicks(lo, hi, n = 5) {
    const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), st = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0);
    const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(6)); return out;
  }
  function tipAt(tip, wrap, x, y, html) {
    tip.innerHTML = html; tip.hidden = false;
    const w = wrap.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(w - tw, x + 12)) + "px"; tip.style.top = Math.max(0, y - 10) + "px";
  }

  // ---------- implied curve ----------
  function zqPath() { // EFFR expected at each contract's mid-quarter + SOFR-EFFR spread
    const s = S.fw?.snapshots?.at(-1); if (!s) return {};
    const fx = sofr(), sp = fx != null ? fx - s.effr : 0;
    const out = {};
    for (const c of S.data.contracts) {
      const mid = iso((ms(c.start) + ms(c.end)) / 2);
      if (mid > iso(ms(s.meetings.at(-1).d) + 45 * 864e5)) continue;
      let r = s.effr, acc = 1, n = 0;
      for (let t = ms(c.start); t < ms(c.end); t += 864e5) { const d = iso(t); r = s.effr; for (const m of s.meetings) if (d > m.d) r = m.rate; acc *= 1 + (r + sp) / 36000; n++; }
      out[c.code] = (acc - 1) * 36000 / n;
    }
    return out;
  }
  function curve() {
    const svg = $("cv"), W = svg.clientWidth || 520, Hh = 320, m = { l: 48, r: 42, t: 14, b: 40 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`); svg.innerHTML = "";
    const cs = S.data.contracts, key = { "1D": "dod", "1W": "wtd", "1M": "mtd" }[S.cmp];
    const now = cs.map((c) => (cur(c) != null ? 100 - cur(c) : null));
    const cmpV = cs.map((c, i) => { const x = chg(c, key); return x && now[i] != null ? { r: now[i] - x.v / 100, m: x.m, d: x.d } : null; });
    const zq = zqPath();
    const vals = [...now, ...cmpV.map((x) => x?.r), ...Object.values(zq), sofr()].filter((v) => v != null);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.12 || 0.05; lo -= pad; hi += pad;
    const dv = cmpV.map((x, i) => (x ? (now[i] - x.r) * 100 : null)), dm = Math.max(5, ...dv.map((v) => Math.abs(v || 0)));
    const X = (i) => m.l + (W - m.l - m.r) * (cs.length === 1 ? 0.5 : i / (cs.length - 1));
    const Y = (v) => m.t + (Hh - m.t - m.b) * (1 - (v - lo) / (hi - lo));
    const Yb = (v) => (Hh - m.b) - (Hh - m.t - m.b) * 0.32 * (0.5 + v / dm / 2); // bar band in the lower third
    const g = svgEl("g", {}, svg);
    for (const t of niceTicks(lo, hi)) { svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: css("--line") }, g); svgEl("text", { x: m.l - 6, y: Y(t) + 3, "text-anchor": "end" }, g).textContent = t.toFixed(2) + "%"; }
    // change bars
    const y0 = Yb(0), bw = Math.max(4, (W - m.l - m.r) / cs.length * 0.42);
    svgEl("line", { x1: m.l, x2: W - m.r, y1: y0, y2: y0, stroke: css("--muted"), "stroke-dasharray": "2 3", opacity: 0.6 }, g);
    dv.forEach((v, i) => { if (v == null) return; const y1 = Yb(v); svgEl("rect", { x: X(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), fill: css(v > 0 ? "--down" : "--up"), opacity: cmpV[i]?.m ? 0.35 : 0.6 }, g); });
    svgEl("text", { x: W - m.r + 6, y: y0 + 3 }, g).textContent = "0bp";
    svgEl("text", { x: W - m.r + 6, y: Yb(dm) + 3 }, g).textContent = "+" + Math.round(dm);
    // SOFR line
    if (sofr() != null) { svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(sofr()), y2: Y(sofr()), stroke: css("--muted"), "stroke-dasharray": "1 3" }, g); svgEl("text", { x: W - m.r + 6, y: Y(sofr()) + 3 }, g).textContent = "SOFR"; }
    const path = (arr, attrs) => { let d = ""; arr.forEach((v, i) => { if (v == null) return; d += (d && arr[i - 1] != null ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1); }); return svgEl("path", { d, fill: "none", ...attrs }, g); };
    path(cs.map((c) => zq[c.code] ?? null), { stroke: css("--c4"), "stroke-width": 1.5, "stroke-dasharray": "2 3" });
    path(cmpV.map((x) => x?.r ?? null), { stroke: css("--c2"), "stroke-width": 1.5, "stroke-dasharray": "5 4" });
    path(now, { stroke: css("--accent"), "stroke-width": 2.5 });
    now.forEach((v, i) => { if (v != null) svgEl("circle", { cx: X(i), cy: Y(v), r: 3, fill: css("--accent") }, g); });
    cs.forEach((c, i) => { if (cs.length > 9 && i % 2) return; svgEl("text", { x: X(i), y: Hh - m.b + 16, "text-anchor": "middle" }, g).textContent = c.code; });
    svgEl("text", { x: m.l, y: Hh - 6 }, g).textContent = "contract (reference quarter start)";
    $("cvLeg").innerHTML = `<span><i style="background:var(--accent)"></i>today</span><span><i class="dash" style="color:var(--c2)"></i>${S.cmp} ago</span><span><i class="dash" style="color:var(--c4)"></i>ZQ fed funds path</span><span><i style="background:var(--down);height:7px;width:7px"></i>rate up</span><span><i style="background:var(--up);height:7px;width:7px"></i>rate down</span>`;
    // hover
    const wrap = svg.parentElement, tip = $("cvTip");
    const hl = svgEl("line", { y1: m.t, y2: Hh - m.b, stroke: css("--muted"), opacity: 0 }, g);
    svg.onpointermove = (e) => {
      const rc = svg.getBoundingClientRect(), x = (e.clientX - rc.left) * W / rc.width;
      const i = Math.max(0, Math.min(cs.length - 1, Math.round((x - m.l) / ((W - m.l - m.r) / Math.max(1, cs.length - 1)))));
      const c = cs[i]; hl.setAttribute("x1", X(i)); hl.setAttribute("x2", X(i)); hl.setAttribute("opacity", 0.5);
      tipAt(tip, wrap, e.clientX - wrap.getBoundingClientRect().left, e.clientY - wrap.getBoundingClientRect().top,
        `<b>SR3${c.code} · ${c.label}</b><br>${dShort(c.start)} – ${dShort(c.end)}<br>Implied: <b>${now[i]?.toFixed(3)}%</b><br>${S.cmp} ago: ${cmpV[i] ? cmpV[i].r.toFixed(3) + "%" + (cmpV[i].m ? " (m)" : "") : "n/a"}<br>Change: <span class="${rcls(dv[i])}">${f(dv[i])}bp</span>${zq[c.code] != null ? `<br>ZQ path: ${zq[c.code].toFixed(3)}% (${f((now[i] - zq[c.code]) * 100)}bp)` : ""}`);
    };
    svg.onpointerleave = () => { tip.hidden = true; hl.setAttribute("opacity", 0); };
  }

  // ---------- calendar spreads ----------
  function spreadDefs() {
    const cs = S.data.contracts.map((c) => c.code), out = [];
    for (let i = 0; i < cs.length - 1; i++) out.push({ id: `${cs[i]}/${cs[i + 1]}`, legs: [[cs[i], 1], [cs[i + 1], -1]], type: "1Q", q: 1 });
    const has = (...k) => k.every((x) => cs.includes(x));
    const add = (id, legs, type, q) => { if (has(...legs.map((l) => l[0]))) out.push({ id, legs, type, q }); };
    const zs = cs.filter((c) => c[0] === "Z");
    for (let i = 0; i < zs.length - 1; i++) add(`${zs[i]}/${zs[i + 1]}`, [[zs[i], 1], [zs[i + 1], -1]], "1Y", 4);
    add("Z6/M7", [["Z6", 1], ["M7", -1]], "2Q", 2);
    add("U7/Z8", [["U7", 1], ["Z8", -1]], "Peak→", 5);
    add("H7/M7/U7", [["H7", 1], ["M7", -2], ["U7", 1]], "Fly", null);
    add("M7/U7/Z7", [["M7", 1], ["U7", -2], ["Z7", 1]], "Fly", null);
    return out;
  }
  const spAt = (h, legs) => { let s = 0, m = false; for (const [k, w] of legs) { const v = val(h, k); if (v == null) return null; s += w * v; m = m || isModel(h, k); } return { v: s * 100, m }; };
  const spNow = (legs) => { let s = 0; for (const [k, w] of legs) { const c = contract(k), v = c ? cur(c) : null; if (v == null) return null; s += w * v; } return s * 100; };
  function spBase(legs, before) { for (let i = H().length - 1; i >= 0; i--) { const h = H()[i]; if (h.d >= before) continue; const x = spAt(h, legs); if (x) return { ...x, d: h.d }; } return null; }
  function spreads() {
    const k = cuts(), defs = spreadDefs();
    let html = "", lastType = "";
    for (const d of defs) {
      const now = spNow(d.legs); if (now == null) continue;
      const grp = { "1Q": "Consecutive quarters", "1Y": "Year-on-year (Dec/Dec)", Fly: "Butterflies" }[d.type] || "Key spreads";
      if (grp !== lastType) html += `<tr class="g"><td colspan="7">${grp}</td></tr>`;
      lastType = grp;
      const c3 = ["dod", "wtd", "mtd"].map((key) => { const b = spBase(d.legs, k[key]); return b ? { v: now - b.v, m: b.m, d: b.d } : null; });
      const hk = d.q ? now / 25 : null;
      html += `<tr data-sp="${d.id}" aria-selected="${S.sp === d.id}" tabindex="0"><td class="code">${d.id}</td><td class="mut">${d.type}</td><td><b>${f(now, 1)}</b></td>` +
        c3.map((x) => (x ? `<td class="${cls(-x.v)}" title="vs ${dLong(x.d)}${x.m ? " (modelled)" : ""}">${f(x.v)}${x.m ? "<sup>m</sup>" : ""}</td>` : `<td class="mut">n/a</td>`)).join("") +
        `<td>${hk != null ? `${f(hk, 2)} <span class="mut">×25bp</span>` : "—"}</td></tr>`;
    }
    $("spBody").innerHTML = html;
    $("spBody").querySelectorAll("tr[data-sp]").forEach((tr) => {
      const go = () => { S.sp = tr.dataset.sp; $("spBody").querySelectorAll("tr[data-sp]").forEach((x) => x.setAttribute("aria-selected", x === tr)); spChart(); };
      tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    spChart();
  }
  function spChart() {
    if (!LW()) return;
    const d = spreadDefs().find((x) => x.id === S.sp) || spreadDefs()[1];
    S.sp = d.id;
    S.charts.sp?.remove?.();
    const chart = mkChart($("sp"), (v) => v.toFixed(1) + "bp"); S.charts.sp = chart;
    const pts = H().map((h) => { const x = spAt(h, d.legs); return x ? { time: h.d, value: +x.v.toFixed(2), m: x.m } : null; }).filter(Boolean);
    addSplit(chart, pts, css("--accent"), d.id);
    const zero = chart.addLineSeries({ color: css("--muted"), lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    if (pts.length) zero.setData([{ time: pts[0].time, value: 0 }, { time: pts.at(-1).time, value: 0 }]);
    $("spT").textContent = `${d.id} history`;
    const now = pts.at(-1)?.value, mn = Math.min(...pts.map((p) => p.value)), mx = Math.max(...pts.map((p) => p.value));
    $("spLeg").innerHTML = pts.length ? `<span>now <b>${f(now)}bp</b></span><span>range ${f(mn)} to ${f(mx)}bp</span><span><i class="dash" style="color:var(--accent)"></i>modelled</span>` : "";
    setRange(chart, pts, S.spRng);
  }

  // ---------- Fed pricing ----------
  const LBK = [[1, "1D"], [5, "1W"], [10, "2W"], [21, "1M"]];
  function fed() {
    const fw0 = S.fw; const fw = fw0 && { ...fw0, snapshots: (fw0.snapshots || []).filter((x) => new Date(ms(x.d)).getUTCDay() % 6) }; if (!fw?.snapshots?.length) { $("fdSub").textContent = "Fed funds pricing is not available right now."; return; }
    const s = fw.snapshots.at(-1), p = fw.snapshots.at(-1 - S.fdCmp) || fw.snapshots[0];
    const lbl = (LBK.find((x) => x[0] === +S.fdCmp) || [0, "1W"])[1];
    const pHike = (m) => Object.entries(m.p).reduce((a, [k, v]) => a + (+k > s.lower + 1e-6 ? v : 0), 0);
    const peak = s.meetings.reduce((a, m) => (m.cum > a.cum ? m : a), s.meetings[0]);
    const pm = (d) => p.meetings.find((x) => x.d === d);
    const nx = s.meetings[0], dec = s.meetings.find((m) => m.d.endsWith("-12-09") || m.d.slice(5, 7) === "12") || s.meetings[1];
    $("fdSub").innerHTML = `Target range ${s.lower.toFixed(2)}–${s.upper.toFixed(2)}%, EFFR ${s.effr.toFixed(2)}% (CBOT settle ${dLong(s.d)}). Compared with ${dLong(p.d)} (${lbl} ago).`;
    const st = (t, v, sm) => `<div>${t}<span>${v}</span>${sm ? `<small>${sm}</small>` : ""}</div>`;
    const dc = (m) => { const o = pm(m.d); return o ? m.cum - o.cum : null; };
    $("fdStats").innerHTML =
      st(`Next FOMC · ${dShort(nx.d)}`, `${(pHike(nx) * 100).toFixed(0)}% hike`, `${f(nx.move)}bp priced`) +
      st(`${dShort(dec.d)} FOMC`, `${f(dec.cum)}bp cum`, `<span class="${rcls(dc(dec))}">${f(dc(dec))}bp vs ${lbl}</span> · P(≥1 hike) ${(pHike(dec) * 100).toFixed(0)}%`) +
      st("Peak priced", `${peak.rate.toFixed(2)}%`, `${f(peak.cum)}bp by ${dShort(peak.d)} ${peak.d.slice(2, 4)}`) +
      st("SOFR − EFFR", `${sofr() != null ? f((sofr() - s.effr) * 100) + "bp" : "—"}`, "funding pressure gauge") +
      st("SR3 peak", (() => { const cs = S.data.contracts.map((c) => [c, 100 - cur(c)]); const t = cs.reduce((a, b) => (b[1] > a[1] ? b : a)); return `${t[1].toFixed(3)}%`; })(), (() => { const cs = S.data.contracts.map((c) => [c, 100 - cur(c)]); const t = cs.reduce((a, b) => (b[1] > a[1] ? b : a)); return `SR3${t[0].code} (${t[0].label}), ${f((t[1] - sofr()) * 100)}bp over SOFR`; })());
    $("fdChH").textContent = `vs ${lbl}`;
    $("fdBody").innerHTML = s.meetings.map((m) => {
      const top = Object.entries(m.p).sort((a, b) => b[1] - a[1])[0], o = pm(m.d), d = o ? m.cum - o.cum : null;
      return `<tr><td class="code">${dLong(m.d)}</td><td>${(+top[0]).toFixed(2)}–${(+top[0] + 0.25).toFixed(2)}% <span class="mut">${(top[1] * 100).toFixed(0)}%</span></td><td>${m.rate.toFixed(3)}%</td><td>${f(m.move)}</td><td><b>${f(m.cum)}</b></td><td>${(pHike(m) * 100).toFixed(0)}%</td><td class="${rcls(d)}">${d != null ? f(d) : "—"}</td></tr>`;
    }).join("");
    fedChart(s, p, lbl);
  }
  function fedChart(s, p, lbl) {
    const svg = $("fd"), W = svg.clientWidth || 520, Hh = 300, m = { l: 44, r: 12, t: 14, b: 40 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`); svg.innerHTML = "";
    const ms_ = s.meetings, pv = ms_.map((x) => p.meetings.find((y) => y.d === x.d)?.cum ?? null);
    const hi = Math.max(25, ...ms_.map((x) => x.cum), ...pv.filter((v) => v != null)) * 1.12, lo = Math.min(0, ...ms_.map((x) => x.cum), ...pv.filter((v) => v != null));
    const bw = (W - m.l - m.r) / ms_.length, X = (i) => m.l + bw * (i + 0.5), Y = (v) => m.t + (Hh - m.t - m.b) * (1 - (v - lo) / (hi - lo));
    const g = svgEl("g", {}, svg);
    for (let t = 0; t <= hi; t += 25) { svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: css("--line") }, g); svgEl("text", { x: m.l - 6, y: Y(t) + 3, "text-anchor": "end" }, g).textContent = t + "bp"; }
    ms_.forEach((x, i) => {
      svgEl("rect", { x: X(i) - bw * 0.32, y: Math.min(Y(0), Y(x.cum)), width: bw * 0.64, height: Math.abs(Y(x.cum) - Y(0)), fill: css("--accent"), opacity: 0.75, rx: 2 }, g);
      const t = new Date(ms(x.d)); svgEl("text", { x: X(i), y: Hh - m.b + 15, "text-anchor": "middle" }, g).textContent = MON[t.getUTCMonth()];
      if (i === 0 || t.getUTCMonth() === 0) svgEl("text", { x: X(i), y: Hh - m.b + 28, "text-anchor": "middle" }, g).textContent = t.getUTCFullYear();
    });
    let d = ""; pv.forEach((v, i) => { if (v == null) return; d += (d ? "L" : "M") + X(i) + "," + Y(v); });
    svgEl("path", { d, fill: "none", stroke: css("--c2"), "stroke-width": 2, "stroke-dasharray": "5 4" }, g);
    pv.forEach((v, i) => { if (v != null) svgEl("circle", { cx: X(i), cy: Y(v), r: 2.5, fill: css("--c2") }, g); });
    $("fdLeg").innerHTML = `<span><i style="background:var(--accent);height:8px"></i>today (${dShort(s.d)})</span><span><i class="dash" style="color:var(--c2)"></i>${lbl} ago (${dShort(p.d)})</span>`;
    const wrap = svg.parentElement, tip = $("fdTip");
    svg.onpointermove = (e) => {
      const rc = svg.getBoundingClientRect(), x = (e.clientX - rc.left) * W / rc.width, i = Math.max(0, Math.min(ms_.length - 1, Math.floor((x - m.l) / bw))), mm = ms_[i];
      tipAt(tip, wrap, e.clientX - wrap.getBoundingClientRect().left, e.clientY - wrap.getBoundingClientRect().top,
        `<b>FOMC ${dLong(mm.d)}</b><br>Implied EFFR ${mm.rate.toFixed(3)}%<br>Cumulative ${f(mm.cum)}bp · this meeting ${f(mm.move)}bp<br>${lbl} ago: ${pv[i] != null ? f(pv[i]) + "bp" : "n/a"} (<span class="${rcls(pv[i] != null ? mm.cum - pv[i] : null)}">${pv[i] != null ? f(mm.cum - pv[i]) : "—"}bp</span>)`);
    };
    svg.onpointerleave = () => { tip.hidden = true; };
  }

  // ---------- research view ----------
  function recap() {
    const r = S.recap, el = $("recap"); if (!r) return;
    const live = (legs) => { const v = spNow(legs); return v == null ? "" : `Now <b>${f(v, 1)}bp</b>`; };
    const liveC = (code) => { const c = contract(code); return c && cur(c) != null ? `Now <b>${cur(c).toFixed(3)}</b> (${(100 - cur(c)).toFixed(3)}%)` : ""; };
    el.innerHTML = `<div class="eyebrow">Research view · ${esc(r.asof)}</div>
      <h2>${esc(r.headline)}</h2>
      <p class="r-sum">${esc(r.summary)}</p>
      <ul class="r-dr">${(r.drivers || []).map(([t, b]) => `<li><b>${esc(t)}.</b> ${esc(b)}</li>`).join("")}</ul>
      <div class="r-two"><div><div class="r-h3">Calendar spreads</div><p>${esc(r.spreads)}</p></div><div><div class="r-h3">Fed pricing</div><p>${esc(r.fed)}</p></div></div>
      <div class="r-h3">Recommendations</div>
      <div class="ideas">${(r.ideas || []).map((i) => `<div class="idea">
        <h4><span class="tag ${esc(i.kind)}">${esc(i.kind === "core" ? "Core" : i.kind === "hedge" ? "Hedge" : "Avoid")}</span>${esc(i.title)}</h4>
        <p class="now">${esc(i.trade)}${i.legs ? ` · ${live(i.legs)}` : i.code ? ` · ${liveC(i.code)}` : ""}</p>
        ${i.levels ? `<dl>${Object.entries(i.levels).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
        <p>${esc(i.why)}</p><p class="rk"><b>Risk:</b> ${esc(i.risk)}</p></div>`).join("")}</div>
      <div class="r-h3">What to watch</div>
      <table class="watch"><tbody>${(r.watch || []).map(([d, e, w]) => `<tr><td>${esc(d)}</td><td>${esc(e)}</td><td>${esc(w)}</td></tr>`).join("")}</tbody></table>
      ${r.sources?.length ? `<p class="r-src">Sources: ${r.sources.map(([t, u]) => `<a href="${esc(u)}" rel="noopener" target="_blank">${esc(t)}</a>`).join(" · ")}</p>` : ""}
      <p class="disc">${esc(r.disclaimer || "Research view for information only, not investment advice.")}</p>`;
    el.hidden = false;
  }

  // ---------- boot ----------
  function renderAll() { stamp(); strip(); picks(); ts(); curve(); spreads(); fed(); recap(); }
  async function load(first) {
    const bust = `?t=${Math.floor(Date.now() / 6e4)}`;
    const j = async (u) => { try { const r = await fetch(u + bust, { cache: "no-store" }); return r.ok ? r.json() : null; } catch { return null; } };
    const [d, fw, rc] = await Promise.all([j("../data/sofr.json"), first || !S.fw ? j("../data/fedwatch.json") : S.fw, first ? j("../data/us-recap.json") : S.recap]);
    if (!d?.contracts?.length) { if (first) $("stBody").innerHTML = '<tr><td colspan="10" class="empty">SOFR futures data is not available right now.</td></tr>'; return; }
    S.data = d; S.fw = fw; S.recap = rc;
    if (first) {
      ["Z6", "H7", "M7", "Z7"].forEach((k) => d.contracts.some((c) => c.code === k) && S.sel.add(k));
      if (!S.sel.size) d.contracts.slice(1, 4).forEach((c) => S.sel.add(c.code));
      btns($("tsMode"), [["rate", "Implied rate"], ["price", "Price"]], S.mode, (v) => { S.mode = v; ts(); });
      btns($("tsRng"), RANGES, S.rng, (v) => { S.rng = v; ts(); });
      btns($("cvCmp"), [["1D", "vs 1D"], ["1W", "vs WTD"], ["1M", "vs MTD"]], S.cmp, (v) => { S.cmp = v; curve(); });
      btns($("spRng"), RANGES, S.spRng, (v) => { S.spRng = v; spChart(); });
      btns($("fdCmp"), LBK.map(([k, l]) => [k, l]), S.fdCmp, (v) => { S.fdCmp = +v; fed(); });
      S.sp = "Z6/H7";
    }
    renderAll();
  }
  load(true);
  setInterval(() => { if (!document.hidden) load(false); }, 5 * 60e3);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => S.data && (curve(), fed()), 150); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => S.data && renderAll());
})();
