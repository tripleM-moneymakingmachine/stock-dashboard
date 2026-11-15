// S&P Sectors tab: the 11 S&P 500 sectors through their Select Sector SPDR ETFs, against SPY and RSP.
// Data: data/spx-sectors.json (scripts/fetch-spx-sectors.mjs: Yahoo prices + State Street flows) and
// data/spx-sectors-recap.json (research view, stances, valuation and earnings inputs; rewritten by Claude).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ms = (d) => Date.parse(d + "T00:00:00Z");
  const dShort = (d) => { const t = new Date(ms(d)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
  const dLong = (d) => { const t = new Date(ms(d)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
  const ok = (v) => v != null && isFinite(v);
  const f = (v, n = 1, suf = "") => (!ok(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(n) + suf);
  const pct = (v, n = 1) => f(v == null ? null : v * 100, n, "%");
  const cls = (v) => (!ok(v) || Math.abs(v) < 1e-9 ? "mut" : v > 0 ? "up" : "down");
  const bn = (m) => (!ok(m) ? "—" : (m > 0 ? "+" : m < 0 ? "−" : "") + "$" + (Math.abs(m) >= 1000 ? (Math.abs(m) / 1000).toFixed(Math.abs(m) >= 10000 ? 1 : 2) + "bn" : Math.abs(m).toFixed(0) + "m"));

  // sector metadata: ETF → name, short name, colour
  const SEC = [
    ["XLK", "Information Technology", "Tech", "#2563eb"],
    ["XLF", "Financials", "Financials", "#0f9d8a"],
    ["XLV", "Health Care", "Health Care", "#db2777"],
    ["XLY", "Consumer Discretionary", "Discretionary", "#d97706"],
    ["XLC", "Communication Services", "Comm Services", "#8b5cf6"],
    ["XLI", "Industrials", "Industrials", "#64748b"],
    ["XLP", "Consumer Staples", "Staples", "#16a34a"],
    ["XLE", "Energy", "Energy", "#b45309"],
    ["XLU", "Utilities", "Utilities", "#0891b2"],
    ["XLRE", "Real Estate", "Real Estate", "#be123c"],
    ["XLB", "Materials", "Materials", "#a16207"],
  ];
  const SYMS = SEC.map((s) => s[0]);
  const META = Object.fromEntries(SEC.map(([k, n, sh, c]) => [k, { n, sh, c }]));
  META.SPY = { n: "S&P 500 (cap-weighted)", sh: "S&P 500", c: "" };
  META.RSP = { n: "S&P 500 equal weight", sh: "Equal weight", c: "" };
  const colorOf = (k) => (k === "SPY" ? css("--ink") : k === "RSP" ? css("--muted") : META[k].c);

  const S = { d: null, r: null, sel: "XLK", relSel: new Set(), relMode: "ret", relRng: "3M", barRng: "m1", tail: 6, flRng: "m1", flUnit: "usd", cfRng: "6M", sort: { k: "m1", dir: -1 }, charts: {}, stats: null };

  // ---------- data access ----------
  const D = () => S.d.d;
  const N = () => S.d.d.length;
  const ser = (k, f = "a") => S.d.s[k]?.[f] || [];
  // last valid index at or before i
  function at(arr, i) { for (let j = Math.min(i, arr.length - 1); j >= 0; j--) if (arr[j] != null) return j; return -1; }
  function idxOnOrBefore(date) { const d = D(); let lo = 0, hi = d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m] <= date) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
  const WINS = [["d1", "1D"], ["w1", "1W"], ["mtd", "MTD"], ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["ytd", "YTD"], ["y1", "1Y"]];
  function startIdx(w) {
    const n = N() - 1, last = D()[n];
    if (w === "d1") return n - 1; if (w === "w1") return n - 5; if (w === "m1") return n - 21; if (w === "m3") return n - 63; if (w === "m6") return n - 126; if (w === "y1") return n - 252;
    if (w === "mtd") return idxOnOrBefore(last.slice(0, 8) + "00") ; // last session of previous month
    if (w === "ytd") return idxOnOrBefore(last.slice(0, 5) + "00-00");
    if (w === "y2") return 0;
    return 0;
  }
  function ret(k, w) {
    const a = ser(k), n = at(a, N() - 1), s = at(a, startIdx(w));
    return n < 0 || s < 0 ? null : a[n] / a[s] - 1;
  }
  const sma = (a, i, p) => { let t = 0, c = 0; for (let j = i - p + 1; j <= i; j++) if (j >= 0 && a[j] != null) { t += a[j]; c++; } return c ? t / c : null; };
  function rsi(a, p = 14) { const n = a.length - 1; let g = 0, l = 0; for (let i = n - p + 1; i <= n; i++) { const x = a[i] - a[i - 1]; if (x > 0) g += x; else l -= x; } return 100 - 100 / (1 + g / (l || 1e-9)); }
  function cmf(k, p = 20) {
    const c = ser(k, "c"), h = ser(k, "h"), l = ser(k, "l"), v = ser(k, "v"); const n = c.length - 1; let mf = 0, vv = 0;
    for (let i = n - p + 1; i <= n; i++) { if (c[i] == null || !v[i]) continue; const rg = h[i] - l[i]; mf += (rg ? (c[i] - l[i] - (h[i] - c[i])) / rg : 0) * v[i]; vv += v[i]; }
    return vv ? mf / vv : null;
  }
  // flows
  const F = (k) => S.d.f?.[k];
  function flowSum(k, w) {
    const f = F(k); if (!f?.d?.length) return null;
    const last = f.d.at(-1);
    let from;
    if (w === "w1") from = f.d.length - 5; else if (w === "m1") from = f.d.length - 21; else if (w === "m3") from = f.d.length - 63; else if (w === "y1") from = f.d.length - 252;
    else if (w === "ytd") from = f.d.findIndex((d) => d >= last.slice(0, 4) + "-01-01"); else from = 0;
    from = Math.max(1, from); let t = 0; for (let i = from; i < f.d.length; i++) t += f.fl[i] || 0; return t;
  }
  const aum = (k) => { const f = F(k); return f?.d?.length ? (f.nav.at(-1) * f.sh.at(-1)) / 1e6 : null; }; // $m

  // ---------- derived stats per sector ----------
  function compute() {
    const out = {}, n = N() - 1;
    for (const k of [...SYMS, "SPY", "RSP"]) {
      const a = ser(k); if (!a.length) continue;
      const i = at(a, n), hi52 = Math.max(...a.slice(-252).filter(ok));
      const o = { k, px: ser(k, "c")[i] };
      for (const [w] of WINS) o[w] = ret(k, w);
      o.ma50 = a[i] / sma(a, i, 50) - 1; o.ma200 = a[i] / sma(a, i, 200) - 1; o.rsi = rsi(a.slice(0, i + 1)); o.cmf = cmf(k); o.dd = a[i] / hi52 - 1;
      o.mom = at(a, n - 21) >= 0 && at(a, n - 252) >= 0 ? a[at(a, n - 21)] / a[at(a, n - 252)] - 1 : null;
      o.fw1 = flowSum(k, "w1"); o.fm1 = flowSum(k, "m1"); o.fm3 = flowSum(k, "m3"); o.fytd = flowSum(k, "ytd"); o.fy1 = flowSum(k, "y1"); o.aum = aum(k);
      o.spark = a.slice(-63);
      out[k] = o;
    }
    for (const k of SYMS) if (out[k] && out.SPY) out[k].rs3 = out[k].m3 - out.SPY.m3;
    // weights rolled forward from the recap's as-of date by price
    const r = S.r, wa = r?.weights;
    if (wa) {
      const i0 = idxOnOrBefore(r.weightsAsOf || D()[0]);
      let tot = 0; const raw = {};
      for (const k of SYMS) { const c = ser(k, "c"), j0 = at(c, i0), j1 = at(c, n); raw[k] = wa[k] != null && j0 >= 0 ? wa[k] * (c[j1] / c[j0]) : null; if (raw[k] != null) tot += raw[k]; }
      const base = SYMS.reduce((t, k) => t + (wa[k] || 0), 0);
      for (const k of SYMS) if (out[k]) out[k].w = raw[k] != null ? (raw[k] / tot) * base : null;
    }
    S.stats = out;
    model();
  }

  // ---------- quant model ----------
  const FACT = [["mom", "Momentum 12-1M", 0.25], ["rs3", "Rel. strength 3M", 0.2], ["ma200", "Trend vs 200d", 0.15], ["flow", "Flows 1M % AUM", 0.15], ["val", "Fwd P/E vs S&P", 0.15], ["eps", "EPS growth", 0.1]];
  function model() {
    const st = S.stats, sec = S.r?.sectors || {}, ipe = S.r?.idx?.pe;
    const raw = {};
    for (const k of SYMS) {
      const o = st[k]; if (!o) continue; const s = sec[k] || {};
      raw[k] = { mom: o.mom, rs3: o.rs3, ma200: o.ma200, flow: ok(o.fm1) && o.aum ? o.fm1 / o.aum : null, val: ok(s.pe) && ipe ? -(s.pe / ipe) : null, eps: ok(s.eps) ? Math.log1p(Math.max(-0.9, s.eps / 100)) : null };
    }
    const z = {};
    for (const [f] of FACT) {
      const xs = SYMS.map((k) => raw[k]?.[f]).filter(ok); if (xs.length < 3) continue;
      const m = xs.reduce((a, b) => a + b, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
      for (const k of SYMS) { (z[k] = z[k] || {})[f] = ok(raw[k]?.[f]) ? Math.max(-2.5, Math.min(2.5, (raw[k][f] - m) / sd)) : null; }
    }
    for (const k of SYMS) {
      if (!st[k]) continue;
      let c = 0; for (const [f, , w] of FACT) c += (z[k]?.[f] ?? 0) * w;
      st[k].z = z[k] || {}; st[k].raw = raw[k]; st[k].score = c; st[k].score100 = Math.round(Math.max(0, Math.min(100, 50 + c * 25)));
    }
    const ranked = SYMS.filter((k) => st[k]).sort((a, b) => st[b].score - st[a].score);
    ranked.forEach((k, i) => (st[k].rank = i + 1));
    S.ranked = ranked;
  }

  // ---------- stamp ----------
  function stamp() {
    const d = S.d, qt = d.quoteTime ? new Date(d.quoteTime * 1000) : null;
    const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const wd = ny.getDay(), m = ny.getHours() * 60 + ny.getMinutes();
    const open = wd >= 1 && wd <= 5 && m >= 570 && m < 960;
    const live = open && qt && Date.now() - qt < 45 * 6e4;
    const fmt = (t, tz) => t.toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const fl = F("XLK");
    $("stamp").innerHTML =
      `<span><i class="dot${live ? " on" : ""}"></i><b>${live ? "Delayed live" : open ? "Delayed" : "Market closed"}</b>${qt ? `${fmt(qt, "America/New_York")} ET · ${fmt(qt, "Asia/Singapore")} SGT` : dLong(D().at(-1))}</span>` +
      `<span><b>S&amp;P 500</b>SPY ${S.stats.SPY?.px?.toFixed(2) ?? "—"} <span class="${cls(S.stats.SPY?.d1)}">${pct(S.stats.SPY?.d1, 2)}</span> · RSP <span class="${cls(S.stats.RSP?.d1)}">${pct(S.stats.RSP?.d1, 2)}</span></span>` +
      (fl ? `<span><b>Flows to</b>${dLong(fl.d.at(-1))}</span>` : `<span><b>Flows</b>not loaded yet</span>`) +
      (d.stale ? `<span class="down"><b>Feed</b>stale, showing the last good file</span>` : "");
  }

  // ---------- tiles ----------
  const stanceCls = (s) => (/^over/i.test(s || "") ? "ow" : /^under/i.test(s || "") ? "uw" : "n");
  function spark(a, color) {
    const xs = a.filter(ok); if (xs.length < 2) return "";
    const lo = Math.min(...xs), hi = Math.max(...xs), W = 150, H = 28;
    const pts = a.map((v, i) => (ok(v) ? `${((i / (a.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}` : null)).filter(Boolean).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
  }
  function tiles() {
    const st = S.stats, sec = S.r?.sectors || {};
    const order = [...SYMS].sort((a, b) => (st[b]?.w ?? 0) - (st[a]?.w ?? 0));
    $("tiles").innerHTML = order.map((k) => {
      const o = st[k]; if (!o) return "";
      const s = sec[k]?.stance;
      return `<button type="button" class="tile" data-k="${k}" aria-pressed="${S.sel === k}">
        <div class="tn"><i style="background:${META[k].c}"></i>${esc(META[k].sh)}</div>
        <div class="tk">${k}${ok(o.w) ? ` · ${o.w.toFixed(1)}% of S&amp;P` : ""}</div>
        <div class="tp">$${o.px?.toFixed(2)} <span class="${cls(o.d1)}" style="font-size:13px">${pct(o.d1, 2)}</span></div>
        <div class="tr"><span>1M <span class="${cls(o.m1)}">${pct(o.m1)}</span></span><span>YTD <span class="${cls(o.ytd)}">${pct(o.ytd)}</span></span></div>
        ${spark(o.spark, META[k].c)}
        ${s ? `<div style="margin-top:6px"><span class="stance ${stanceCls(s)}">${esc(s)}</span></div>` : ""}
      </button>`;
    }).join("");
    $("tiles").querySelectorAll(".tile").forEach((b) => b.addEventListener("click", () => select(b.dataset.k)));
    const r = S.r; $("wNote").textContent = r?.weights ? `Index weights: ${r.weightsSrc || ""}. Sparklines: last 3 months.` : "";
  }
  function select(k) {
    if (!META[k] || k === "SPY" || k === "RSP") return;
    S.sel = k;
    document.querySelectorAll(".tile").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k));
    document.querySelectorAll("#pfBody tr[data-k]").forEach((tr) => tr.setAttribute("aria-selected", tr.dataset.k === k));
    if (!S.relSel.has(k)) { if (S.relSel.size >= 6) S.relSel.delete([...S.relSel][0]); S.relSel.add(k); picks(); rel(); }
    cf();
  }

  // ---------- performance table ----------
  const COLS = [
    ["w", "Weight", (o) => ok(o.w) ? `${o.w.toFixed(1)}%<span class="wbar" style="width:${Math.min(40, o.w)}px"></span>` : "—"],
    ...WINS.map(([k, l]) => [k, l, (o) => `<span class="${cls(o[k])}">${pct(o[k])}</span>`, true]),
    ["rs3", "vs SPY 3M", (o) => `<span class="${cls(o.rs3)}">${f(ok(o.rs3) ? o.rs3 * 100 : null, 1, "pt")}</span>`, true],
    ["ma50", "vs 50d", (o) => `<span class="${cls(o.ma50)}">${pct(o.ma50)}</span>`, true],
    ["ma200", "vs 200d", (o) => `<span class="${cls(o.ma200)}">${pct(o.ma200)}</span>`, true],
    ["rsi", "RSI 14", (o) => `<span class="${o.rsi >= 70 ? "down" : o.rsi <= 30 ? "up" : ""}">${ok(o.rsi) ? o.rsi.toFixed(0) : "—"}</span>`],
    ["cmf", "CMF 20d", (o) => `<span class="${cls(o.cmf)}">${ok(o.cmf) ? (o.cmf > 0 ? "+" : "") + o.cmf.toFixed(2) : "—"}</span>`, true],
    ["fw1", "Flow 1W", (o) => `<span class="${cls(o.fw1)}">${bn(o.fw1)}</span>`, true],
    ["fm1", "Flow 1M", (o) => `<span class="${cls(o.fm1)}">${bn(o.fm1)}</span>`, true],
    ["fm3", "Flow 3M", (o) => `<span class="${cls(o.fm3)}">${bn(o.fm3)}</span>`, true],
  ];
  function heat(k, v, rows) {
    const xs = rows.map((o) => o[k]).filter(ok).sort((a, b) => a - b); if (!ok(v) || xs.length < 3) return "";
    const p = xs.indexOf(v) / (xs.length - 1), a = Math.abs(p - 0.5) * 2;
    const c = p >= 0.5 ? "--up" : "--down";
    return `background:color-mix(in srgb,var(${c}) ${(a * 16).toFixed(0)}%,transparent)`;
  }
  function perf() {
    const st = S.stats, { k: sk, dir } = S.sort;
    $("pfHead").innerHTML = `<tr><th scope="col" data-s="name">Sector</th><th scope="col" data-s="name">ETF</th>${COLS.map(([k, l]) => `<th scope="col" data-s="${k}"${sk === k ? ` aria-sort="${dir < 0 ? "descending" : "ascending"}"` : ""}>${l}</th>`).join("")}</tr>`;
    const rows = SYMS.map((k) => st[k]).filter(Boolean);
    rows.sort((a, b) => (sk === "name" ? META[a.k].n.localeCompare(META[b.k].n) * -dir : dir < 0 ? (b[sk] ?? -1e9) - (a[sk] ?? -1e9) : (a[sk] ?? 1e9) - (b[sk] ?? 1e9)));
    const row = (o, bm) => `<tr data-k="${o.k}"${bm ? ' class="bm"' : ` aria-selected="${S.sel === o.k}"`}><td class="nm">${bm ? "" : `<i style="background:${META[o.k].c}"></i>`}${esc(META[o.k].n)}</td><td class="code">${o.k}</td>${COLS.map(([k, , fn, h]) => `<td><span class="heat" style="${!bm && h ? heat(k, o[k], rows) : ""}">${fn(o)}</span></td>`).join("")}</tr>`;
    $("pfBody").innerHTML = rows.map((o) => row(o)).join("") + ["SPY", "RSP"].filter((k) => st[k]).map((k) => row(st[k], true)).join("");
    $("pfHead").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.s; S.sort = S.sort.k === k ? { k, dir: -S.sort.dir } : { k, dir: -1 }; perf();
    }));
    $("pfBody").querySelectorAll("tr[data-k]:not(.bm)").forEach((tr) => tr.addEventListener("click", () => select(tr.dataset.k)));
  }

  // ---------- svg helpers ----------
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, at, parent) { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); parent?.appendChild(e); return e; }
  function tipAt(tip, wrap, x, y, html) {
    tip.innerHTML = html; tip.hidden = false;
    const w = wrap.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(0, Math.min(w - tw, x + 14 > w - tw ? x - tw - 14 : x + 14)) + "px";
    tip.style.top = Math.max(0, y - th - 10) + "px";
  }
  function btns(el, items, cur, on) {
    el.innerHTML = items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); on(b.dataset.v); }));
  }
  function niceStep(span, n = 5) { const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }

  // horizontal bar chart: rows [{k,label,v,color,extra}], fmt(v)
  function hbar(svg, tipEl, rows, fmt, refs = [], tipFn) {
    const W = svg.clientWidth || 560, rh = 28, m = { l: 118, r: 58, t: 14, b: 26 }, Hh = m.t + m.b + rows.length * rh;
    svg.setAttribute("height", Hh); svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`); svg.innerHTML = "";
    const vals = [...rows.map((r) => r.v), ...refs.map((r) => r.v)].filter(ok);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const span = hi - lo || 1; if (lo < 0) lo -= span * 0.16; hi += span * (hi > 0 ? 0.16 : 0.04);
    const X = (v) => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r);
    const g = svgEl("g", {}, svg), step = niceStep(hi - lo);
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      svgEl("line", { x1: X(t), x2: X(t), y1: m.t - 4, y2: Hh - m.b, stroke: css("--line"), "stroke-width": Math.abs(t) < step / 2 ? 1.5 : 1 }, g);
      svgEl("text", { x: X(t), y: Hh - m.b + 15, "text-anchor": "middle" }, g).textContent = fmt(t, true);
    }
    rows.forEach((r, i) => {
      const y = m.t + i * rh, x0 = X(0), x1 = X(ok(r.v) ? r.v : 0);
      svgEl("text", { x: m.l - 8, y: y + rh / 2 + 4, "text-anchor": "end", style: `fill:var(--ink);font-weight:${r.k === S.sel ? 700 : 500}` }, g).textContent = r.label;
      svgEl("rect", { x: Math.min(x0, x1), y: y + 5, width: Math.max(1, Math.abs(x1 - x0)), height: rh - 10, rx: 2, fill: r.color, opacity: r.k === S.sel ? 1 : 0.78 }, g);
      svgEl("text", { x: r.v >= 0 ? x1 + 5 : x1 - 5, y: y + rh / 2 + 4, "text-anchor": r.v >= 0 ? "start" : "end", style: "fill:var(--ink)" }, g).textContent = ok(r.v) ? fmt(r.v) : "n/a";
    });
    for (const rf of refs) if (ok(rf.v)) {
      svgEl("line", { x1: X(rf.v), x2: X(rf.v), y1: m.t - 6, y2: Hh - m.b, stroke: rf.color, "stroke-width": 1.5, "stroke-dasharray": rf.dash ? "4 3" : "none" }, g);
      svgEl("text", { x: X(rf.v), y: m.t - 6 + (rf.dash ? 0 : 0), "text-anchor": "middle", style: `fill:${rf.color};font-size:9.5px` }, g).textContent = rf.label;
    }
    const wrap = svg.parentElement;
    svg.onpointermove = (e) => {
      const rc = svg.getBoundingClientRect(), y = (e.clientY - rc.top) * Hh / rc.height, i = Math.floor((y - m.t) / rh);
      if (i < 0 || i >= rows.length) { tipEl.hidden = true; return; }
      tipAt(tipEl, wrap, e.clientX - wrap.getBoundingClientRect().left, e.clientY - wrap.getBoundingClientRect().top, tipFn(rows[i]));
    };
    svg.onpointerleave = () => { tipEl.hidden = true; };
    svg.onclick = (e) => { const rc = svg.getBoundingClientRect(), y = (e.clientY - rc.top) * Hh / rc.height, i = Math.floor((y - m.t) / rh); if (rows[i]) select(rows[i].k); };
  }

  // ---------- return bars ----------
  function bars() {
    const st = S.stats, w = S.barRng;
    const rows = SYMS.filter((k) => st[k]).map((k) => ({ k, label: META[k].sh, v: st[k][w] * 100, color: META[k].c })).sort((a, b) => b.v - a.v);
    hbar($("bar"), $("barTip"), rows, (v, ax) => (ax ? (v > 0 ? "+" : "") + v.toFixed(Math.abs(v) < 2 && v % 1 ? 1 : 0) + "%" : f(v, 1, "%")),
      [{ v: st.SPY?.[w] * 100, color: css("--ink"), label: "SPY" }, { v: st.RSP?.[w] * 100, color: css("--muted"), label: "RSP", dash: true }],
      (r) => { const o = st[r.k]; return `<b>${esc(META[r.k].n)} (${r.k})</b><br>${WINS.find((x) => x[0] === w)[1]} return <span class="${cls(r.v)}">${f(r.v, 2, "%")}</span><br>vs SPY <span class="${cls(r.v - st.SPY[w] * 100)}">${f(r.v - st.SPY[w] * 100, 2, "pt")}</span> · vs RSP <span class="${cls(r.v - st.RSP[w] * 100)}">${f(r.v - st.RSP[w] * 100, 2, "pt")}</span>${ok(o.w) ? `<br>Index weight ${o.w.toFixed(1)}%` : ""}`; });
  }

  // ---------- rotation map ----------
  function rrgSeries(k) {
    const a = ser(k), b = ser("SPY"), n = N();
    const raw = a.map((v, i) => (ok(v) && ok(b[i]) ? v / b[i] : null));
    const rel = []; let e = null; for (const v of raw) { if (ok(v)) e = e == null ? v : e + (2 / 11) * (v - e); rel.push(ok(v) ? e : null); } // 10-day EMA smooths daily noise
    const ratio = rel.map((v, i) => { if (!ok(v) || i < 50) return null; const m = sma(rel, i, 50); return m ? 100 * v / m : null; });
    const mom = ratio.map((v, i) => (ok(v) && ok(ratio[i - 10]) ? 100 * v / ratio[i - 10] : null));
    const pts = [];
    for (let i = n - 1, c = 0; i >= 0 && c <= S.tail; i -= 5, c++) if (ok(ratio[i]) && ok(mom[i])) pts.unshift({ x: ratio[i], y: mom[i], d: D()[i] });
    return pts;
  }
  const QUAD = (x, y) => (x >= 100 ? (y >= 100 ? "Leading" : "Weakening") : y >= 100 ? "Improving" : "Lagging");
  function rrg() {
    const svg = $("rrg"), W = svg.clientWidth || 560, Hh = 380, m = { l: 44, r: 16, t: 14, b: 32 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`); svg.innerHTML = "";
    const all = Object.fromEntries(SYMS.map((k) => [k, rrgSeries(k)]));
    const xs = Object.values(all).flat().map((p) => p.x), ys = Object.values(all).flat().map((p) => p.y);
    const sx = Math.max(1.5, ...xs.map((x) => Math.abs(x - 100))) * 1.12, sy = Math.max(1, ...ys.map((y) => Math.abs(y - 100))) * 1.12;
    const X = (x) => m.l + ((x - (100 - sx)) / (2 * sx)) * (W - m.l - m.r), Y = (y) => m.t + (1 - (y - (100 - sy)) / (2 * sy)) * (Hh - m.t - m.b);
    const g = svgEl("g", {}, svg);
    const q = [["Leading", 1, 1, "--up"], ["Weakening", 1, 0, "--c2"], ["Lagging", 0, 0, "--down"], ["Improving", 0, 1, "--accent"]];
    for (const [lab, rx, ry, c] of q) {
      const x0 = rx ? X(100) : m.l, x1 = rx ? W - m.r : X(100), y0 = ry ? m.t : Y(100), y1 = ry ? Y(100) : Hh - m.b;
      svgEl("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: css(c), opacity: 0.06 }, g);
      svgEl("text", { x: rx ? x1 - 6 : x0 + 6, y: ry ? y0 + 14 : y1 - 6, "text-anchor": rx ? "end" : "start", style: `fill:${css(c)};font-weight:600;letter-spacing:.06em` }, g).textContent = lab.toUpperCase();
    }
    svgEl("line", { x1: X(100), x2: X(100), y1: m.t, y2: Hh - m.b, stroke: css("--line"), "stroke-width": 1.5 }, g);
    svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(100), y2: Y(100), stroke: css("--line"), "stroke-width": 1.5 }, g);
    for (const t of [100 - sx * 0.66, 100 - sx * 0.33, 100 + sx * 0.33, 100 + sx * 0.66]) svgEl("text", { x: X(t), y: Hh - m.b + 15, "text-anchor": "middle" }, g).textContent = t.toFixed(1);
    for (const t of [100 - sy * 0.66, 100 + sy * 0.66]) svgEl("text", { x: m.l - 6, y: Y(t) + 3, "text-anchor": "end" }, g).textContent = t.toFixed(1);
    svgEl("text", { x: W - m.r, y: Hh - 4, "text-anchor": "end" }, g).textContent = "Relative strength →";
    const hits = [];
    for (const k of SYMS) {
      const pts = all[k]; if (!pts.length) continue; const c = META[k].c, on = k === S.sel;
      svgEl("polyline", { points: pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" "), fill: "none", stroke: c, "stroke-width": on ? 2.4 : 1.4, opacity: on ? 1 : 0.6 }, g);
      pts.slice(0, -1).forEach((p) => svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: 2, fill: c, opacity: 0.6 }, g));
      const p = pts.at(-1);
      svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: on ? 6.5 : 5, fill: c, stroke: css("--panel"), "stroke-width": 1.5 }, g);
      svgEl("text", { x: X(p.x) + 8, y: Y(p.y) + 4, style: `fill:${c};font-weight:600` }, g).textContent = k;
      hits.push({ k, x: X(p.x), y: Y(p.y), p, pts });
    }
    const wrap = svg.parentElement, tip = $("rrgTip");
    const near = (e) => { const rc = svg.getBoundingClientRect(), x = (e.clientX - rc.left) * W / rc.width, y = (e.clientY - rc.top) * Hh / rc.height; let b = null, bd = 400; for (const h of hits) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; b = h; } } return b; };
    svg.onpointermove = (e) => {
      const h = near(e); if (!h) { tip.hidden = true; return; }
      const prev = h.pts.length > 1 ? h.pts[h.pts.length - 2] : null;
      tipAt(tip, wrap, e.clientX - wrap.getBoundingClientRect().left, e.clientY - wrap.getBoundingClientRect().top,
        `<b>${esc(META[h.k].n)} (${h.k})</b><br>${QUAD(h.p.x, h.p.y)} · RS ${h.p.x.toFixed(2)} · momentum ${h.p.y.toFixed(2)}${prev ? `<br>A week ago: ${QUAD(prev.x, prev.y)}` : ""}`);
    };
    svg.onpointerleave = () => { tip.hidden = true; };
    svg.onclick = (e) => { const h = near(e); if (h) select(h.k); };
    S.quad = Object.fromEntries(hits.map((h) => [h.k, QUAD(h.p.x, h.p.y)]));
  }

  // ---------- relative performance (lightweight-charts) ----------
  const LW = () => window.LightweightCharts;
  function mkChart(el, fmt, opts = {}) {
    el.innerHTML = "";
    return LW().createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono"), fontSize: 11 },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line"), fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 }, localization: { priceFormatter: fmt },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }, ...opts,
    });
  }
  const RNG = [["1M", "1M", 21], ["3M", "3M", 63], ["6M", "6M", 126], ["YTD", "YTD"], ["1Y", "1Y", 252], ["2Y", "2Y"]];
  function rngStart(r) { const n = N() - 1, x = RNG.find((z) => z[0] === r); if (r === "YTD") return startIdx("ytd"); if (r === "2Y") return 0; return Math.max(0, n - x[2]); }
  function picks() {
    const el = $("relPick"), list = [...SYMS, "SPY", "RSP"];
    el.innerHTML = list.map((k) => `<button type="button" data-v="${k}" aria-pressed="${S.relSel.has(k)}"><i style="background:${S.relSel.has(k) ? colorOf(k) : "var(--line)"}"></i>${k === "SPY" || k === "RSP" ? k : META[k].sh}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.v; if (S.relSel.has(k)) { if (S.relSel.size > 1) S.relSel.delete(k); } else { if (S.relSel.size >= 6) S.relSel.delete([...S.relSel][0]); S.relSel.add(k); }
      picks(); rel();
    }));
  }
  function rel() {
    if (!LW()) { $("rel").innerHTML = '<p class="empty">Chart library did not load.</p>'; return; }
    S.charts.rel?.remove?.();
    const ch = mkChart($("rel"), (v) => (v > 0 ? "+" : "") + v.toFixed(1) + (S.relMode === "rel" ? "pt" : "%"));
    S.charts.rel = ch;
    const i0 = rngStart(S.relRng), spy = ser("SPY"), b0 = spy[at(spy, i0)], leg = [];
    for (const k of S.relSel) {
      const a = ser(k), s0 = a[at(a, i0)]; if (!ok(s0)) continue;
      const pts = [];
      for (let i = i0; i < N(); i++) { if (!ok(a[i])) continue; let v = (a[i] / s0 - 1) * 100; if (S.relMode === "rel") { if (k === "SPY" || !ok(spy[i])) continue; v -= (spy[i] / b0 - 1) * 100; } pts.push({ time: D()[i], value: +v.toFixed(3) }); }
      if (!pts.length) continue;
      ch.addLineSeries({ color: colorOf(k), lineWidth: k === S.sel ? 3 : 2, lineStyle: k === "RSP" ? 2 : 0, priceLineVisible: false, title: k }).setData(pts);
      leg.push(`<span><i style="background:${colorOf(k)}"></i>${k === "SPY" || k === "RSP" ? META[k].sh : META[k].sh}: <b class="${cls(pts.at(-1).value)}">${f(pts.at(-1).value, 1, S.relMode === "rel" ? "pt" : "%")}</b></span>`);
    }
    $("relLeg").innerHTML = leg.join("");
    ch.timeScale().fitContent();
  }

  // ---------- flows ----------
  const FLW = [["w1", "1W"], ["m1", "1M"], ["m3", "3M"], ["ytd", "YTD"], ["y1", "1Y"]];
  function flowBars() {
    const w = S.flRng, pctMode = S.flUnit === "pct";
    const rows = SYMS.filter((k) => F(k)).map((k) => { const s = flowSum(k, w), a = aum(k); return { k, label: META[k].sh, v: pctMode ? (ok(s) && a ? (s / a) * 100 : null) : ok(s) ? s / 1000 : null, s, a, color: META[k].c }; }).sort((a, b) => (b.v ?? -1e9) - (a.v ?? -1e9));
    if (!rows.length) { $("flb").innerHTML = ""; $("flb").setAttribute("height", 60); $("flb").insertAdjacentHTML("beforeend", `<text x="12" y="30" style="fill:var(--muted)">Flow data not loaded yet; it is added by the daily State Street refresh.</text>`); return; }
    const spy = flowSum("SPY", w), spyA = aum("SPY");
    hbar($("flb"), $("flbTip"), rows, (v, ax) => (pctMode ? (v > 0 ? "+" : "") + v.toFixed(ax ? (Math.abs(v) < 1 ? 1 : 0) : 2) + "%" : (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(ax ? (Math.abs(v) < 1 && v ? 1 : 0) : 2) + "bn"),
      [], (r) => `<b>${esc(META[r.k].n)} (${r.k})</b><br>Net flow ${FLW.find((x) => x[0] === w)[1]}: <span class="${cls(r.s)}">${bn(r.s)}</span><br>${ok(r.s) && r.a ? `${f((r.s / r.a) * 100, 2, "%")} of assets` : ""}<br>AUM $${(r.a / 1000).toFixed(1)}bn · ${dLong(F(r.k).d.at(-1))}`);
    $("flSub").innerHTML = `Net new money into each sector's SPDR ETF (creations minus redemptions = change in shares outstanding × NAV), published by State Street with a one-day lag; splits excluded. For scale, SPY took in <b class="${cls(spy)}">${bn(spy)}</b> over the same ${FLW.find((x) => x[0] === w)[1]}${spyA ? ` (${f((spy / spyA) * 100, 2, "%")} of its $${(spyA / 1e6).toFixed(2)}tn)` : ""}.`;
  }
  const CFR = [["1M", "1M", 21], ["3M", "3M", 63], ["6M", "6M", 126], ["YTD", "YTD"], ["1Y", "1Y", 252], ["2Y", "2Y"]];
  function cf() {
    const k = S.sel, fl = F(k);
    $("cfT").textContent = `Cumulative flows · ${META[k].sh} (${k})`;
    if (!LW()) return;
    S.charts.cf?.remove?.();
    if (!fl?.d?.length) { $("cf").innerHTML = '<p class="empty">Flow data not loaded yet.</p>'; $("cfLeg").innerHTML = ""; return; }
    const r = CFR.find((x) => x[0] === S.cfRng), n = fl.d.length;
    let i0 = r[0] === "YTD" ? fl.d.findIndex((d) => d >= fl.d.at(-1).slice(0, 4) + "-01-01") : r[0] === "2Y" ? 1 : Math.max(1, n - r[2]);
    const ch = mkChart($("cf"), (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "bn" : Math.abs(v).toFixed(0) + "m"), { leftPriceScale: { visible: true, borderColor: css("--line") } });
    S.charts.cf = ch;
    let cum = 0; const line = [], hist = [];
    for (let i = i0; i < n; i++) { cum += fl.fl[i] || 0; line.push({ time: fl.d[i], value: +cum.toFixed(1) }); hist.push({ time: fl.d[i], value: fl.fl[i] || 0, color: (fl.fl[i] || 0) >= 0 ? css("--up") : css("--down") }); }
    ch.addHistogramSeries({ priceScaleId: "right", priceLineVisible: false, lastValueVisible: false, title: "daily" }).setData(hist);
    ch.addLineSeries({ priceScaleId: "left", color: META[k].c, lineWidth: 2, priceLineVisible: false, title: "cumulative" }).setData(line);
    ch.timeScale().fitContent();
    const a = aum(k);
    $("cfLeg").innerHTML = `<span><i style="background:${META[k].c}"></i>cumulative ${r[1]}: <b class="${cls(cum)}">${bn(cum)}</b>${a ? ` (${f((cum / a) * 100, 1, "%")} of AUM)` : ""}</span><span><i style="background:var(--up);height:8px"></i>creations</span><span><i style="background:var(--down);height:8px"></i>redemptions</span><span>AUM <b>$${a ? (a / 1000).toFixed(1) : "—"}bn</b></span>`;
  }

  // ---------- model scorecard ----------
  function zcell(z, txt) {
    if (!ok(z)) return `<span class="zc mut">${txt}</span>`;
    const c = z >= 0 ? "--up" : "--down", a = Math.min(1, Math.abs(z) / 2);
    return `<span class="zc" style="background:color-mix(in srgb,var(${c}) ${(a * 30).toFixed(0)}%,transparent)" title="z = ${z.toFixed(2)}">${txt}</span>`;
  }
  function scorecard() {
    const st = S.stats, sec = S.r?.sectors || {};
    $("mdBody").innerHTML = S.ranked.map((k) => {
      const o = st[k], s = sec[k] || {}, z = o.z;
      return `<tr data-k="${k}"><td class="code">${o.rank}</td><td class="nm"><i style="background:${META[k].c}"></i>${esc(META[k].n)}</td>
        <td><b>${o.score100}</b><span class="bar" style="width:${o.score100 * 0.5}px;background:${META[k].c}"></span></td>
        <td>${zcell(z.mom, pct(o.mom, 0))}</td><td>${zcell(z.rs3, f(ok(o.rs3) ? o.rs3 * 100 : null, 1, "pt"))}</td><td>${zcell(z.ma200, pct(o.ma200))}</td>
        <td>${zcell(z.flow, ok(o.raw?.flow) ? f(o.raw.flow * 100, 2, "%") : "—")}</td><td>${zcell(z.val, ok(s.pe) ? s.pe.toFixed(1) + "x" : "n/a")}</td><td>${zcell(z.eps, ok(s.eps) ? f(s.eps, 0, "%") : "n/a")}</td>
        <td>${s.stance ? `<span class="stance ${stanceCls(s.stance)}">${esc(s.stance)}</span>` : ""}</td></tr>`;
    }).join("");
    $("mdBody").querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => select(tr.dataset.k)));
    $("mdSub").textContent = "Six factors, each z-scored across the 11 sectors and capped at ±2.5, then weighted: momentum 25%, 3-month relative strength 20%, trend 15%, flows 15%, valuation 15%, earnings growth 10%. Score 50 is average; each 25 points is one weighted standard deviation. Cells are shaded by z-score.";
    const ix = S.r?.idx;
    $("mdNote").innerHTML = `Price and flow factors update with every refresh. Valuation: forward 12-month P/E against the S&amp;P 500's ${ix?.pe ?? "—"}x (lower scores higher). EPS growth: latest-quarter year-on-year, log-scaled so Energy's triple-digit rebound doesn't swamp the rest. A sector missing an input scores 0 on that factor. Sources: ${esc(ix?.src || "")}; per-sector sources are on the cards below. The research stance is a judgment call that also weighs catalysts and risks the model can't see.`;
  }

  // ---------- sector cards ----------
  function cards() {
    const st = S.stats, sec = S.r?.sectors || {};
    $("scards").innerHTML = S.ranked.map((k) => {
      const o = st[k], s = sec[k] || {};
      return `<article class="scard" data-k="${k}">
        <h4><i style="background:${META[k].c}"></i>${esc(META[k].n)} <span class="mut" style="font:500 12px var(--f-mono)">${k}</span>${s.stance ? `<span class="stance ${stanceCls(s.stance)}">${esc(s.stance)}</span>` : ""}</h4>
        <div class="kv"><span>Model <b>#${o.rank} · ${o.score100}</b></span><span>${S.quad?.[k] ? `Rotation <b>${S.quad[k]}</b>` : ""}</span><span>1M <b class="${cls(o.m1)}">${pct(o.m1)}</b></span><span>YTD <b class="${cls(o.ytd)}">${pct(o.ytd)}</b></span><span>Flow 1M <b class="${cls(o.fm1)}">${bn(o.fm1)}</b></span>${ok(s.pe) ? `<span>Fwd P/E <b>${s.pe.toFixed(1)}x</b></span>` : ""}${ok(s.eps) ? `<span>EPS Q3 <b class="${cls(s.eps)}">${f(s.eps, 0, "%")}</b></span>` : ""}</div>
        ${s.view ? `<p><span class="lab">Research</span>${esc(s.view)}</p>` : ""}
        ${s.modelView ? `<p><span class="lab">Model</span>${esc(s.modelView)}</p>` : ""}
        ${s.trade ? `<p><span class="lab">Positioning</span><b>${esc(s.trade)}</b></p>` : ""}
        ${s.risk ? `<p class="rk"><b>Risk:</b> ${esc(s.risk)}</p>` : ""}
        ${s.peSrc ? `<p class="rk" style="font-size:11.5px">Valuation: ${esc(s.peSrc)}</p>` : ""}
      </article>`;
    }).join("");
  }

  // ---------- research view ----------
  function recap() {
    const r = S.r, el = $("recap"); if (!r) return;
    el.innerHTML = `<div class="eyebrow">Research view · ${esc(r.asof)}</div>
      <h2>${esc(r.headline)}</h2>
      <p class="r-sum">${esc(r.summary)}</p>
      <ul class="r-dr">${(r.drivers || []).map(([t, b]) => `<li><b>${esc(t)}.</b> ${esc(b)}</li>`).join("")}</ul>
      <div class="r-three"><div><div class="r-h3">Rotation</div><p>${esc(r.rotation)}</p></div><div><div class="r-h3">Money flows</div><p>${esc(r.flows)}</p></div><div><div class="r-h3">What the model says</div><p>${esc(r.model)}</p></div></div>
      <div class="r-h3">Stances</div>
      <p style="margin:0;font-size:14px">${["Overweight", "Neutral", "Underweight"].map((g) => { const ks = SYMS.filter((k) => (r.sectors?.[k]?.stance || "").startsWith(g)); return ks.length ? `<b class="${g === "Overweight" ? "up" : g === "Underweight" ? "down" : ""}">${g}:</b> ${ks.map((k) => `${esc(META[k].sh)}${r.sectors[k].stance !== g ? ` <span class="mut">(${esc(r.sectors[k].stance.replace(g + ", ", ""))})</span>` : ""}`).join(", ")}` : ""; }).filter(Boolean).join(" &nbsp;·&nbsp; ")}</p>
      <div class="r-h3">What to watch</div>
      <table class="watch"><tbody>${(r.watch || []).map(([d, e, w]) => `<tr><td>${esc(d)}</td><td>${esc(e)}</td><td>${esc(w)}</td></tr>`).join("")}</tbody></table>
      ${r.sources?.length ? `<p class="r-src">Sources: ${r.sources.map(([t, u]) => `<a href="${esc(u)}" rel="noopener" target="_blank">${esc(t)}</a>`).join(" · ")}</p>` : ""}
      <p class="disc">${esc(r.disclaimer || "Research view for information only, not investment advice.")}</p>`;
    el.hidden = false;
  }

  // ---------- boot ----------
  function renderAll() { compute(); stamp(); tiles(); perf(); bars(); rrg(); picks(); rel(); flowBars(); cf(); scorecard(); cards(); recap(); }
  async function load(first) {
    const bust = `?t=${Math.floor(Date.now() / 6e4)}`;
    const j = async (u) => { try { const r = await fetch(u + bust, { cache: "no-store" }); return r.ok ? r.json() : null; } catch { return null; } };
    const [d, r] = await Promise.all([j("../data/spx-sectors.json"), first ? j("../data/spx-sectors-recap.json") : S.r]);
    if (!d?.d?.length || !d.s?.SPY) { if (first) $("pfBody").innerHTML = '<tr><td colspan="18" class="empty">Sector data is not available right now.</td></tr>'; return; }
    S.d = d; S.r = r;
    if (first) {
      ["XLK", "XLV", "XLF", "XLP", "SPY", "RSP"].forEach((k) => S.relSel.add(k));
      btns($("barRng"), WINS, S.barRng, (v) => { S.barRng = v; bars(); });
      btns($("rrgTail"), [[3, "3W"], [6, "6W"], [10, "10W"]], S.tail, (v) => { S.tail = +v; rrg(); });
      btns($("relMode"), [["ret", "Return"], ["rel", "vs S&P 500"]], S.relMode, (v) => { S.relMode = v; rel(); });
      btns($("relRng"), RNG.map(([k, l]) => [k, l]), S.relRng, (v) => { S.relRng = v; rel(); });
      btns($("flRng"), FLW, S.flRng, (v) => { S.flRng = v; flowBars(); });
      btns($("flUnit"), [["usd", "$ bn"], ["pct", "% of AUM"]], S.flUnit, (v) => { S.flUnit = v; flowBars(); });
      btns($("cfRng"), CFR.map(([k, l]) => [k, l]), S.cfRng, (v) => { S.cfRng = v; cf(); });
    }
    renderAll();
  }
  load(true);
  setInterval(() => { if (!document.hidden) load(false); }, 5 * 60e3);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => S.d && (bars(), rrg(), flowBars()), 150); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => S.d && renderAll());
})();
