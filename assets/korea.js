// Korea tab: KOFIA Korea Treasury Bond (KTB) curve, quasi-sovereign curves (MSB from KOFIA quotes; KDB / IBK / KEXIM fitted to
// KOFIA OTC trades), tenor history, and KTBs by issue code and ISIN. Built from the China tab (assets/china.js).
// Reads ../data/korea.json (written by scripts/fetch-korea.mjs) and re-checks it every minute.
(() => {
  const SRC = "../data/korea.json";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const TEN = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50];
  const lab = (t) => t < 1 ? `${Math.round(t * 12)}M` : `${t}Y`;
  const f2 = (v, n = 2) => v == null || !isFinite(v) ? "–" : (+v).toFixed(n);
  const bp = (v, n = 1) => v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(+v).toFixed(n)}`;
  const cls = (v) => v == null || !isFinite(v) || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down"; // yields up = green, as on the Macro tab
  let D = null;
  const st = { cvMax: 30, pbMax: 30, pbK: "kdb", hT: 10, hR: "6M", hA: "t:10", hB: "", hC: "", hD: "", hSec: "", q: "", iss: "All", type: "All", mat: "", grp: "bucket", traded: false, sort: "ttm", dir: 1 };

  // ---------- series helpers ----------
  const ser = (t) => D?.tenors?.[t] || [];
  const back = (s, days) => { // value on or before (last date - days)
    if (!s.length) return null;
    const cut = new Date(Date.parse(s.at(-1)[0]) - days * 864e5).toISOString().slice(0, 10);
    for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= cut) return s[i][1];
    return null;
  };
  const chg = (s, days) => { if (!s.length) return null; const p = days === 1 ? (s.length > 1 ? s.at(-2)[1] : null) : back(s, days); return p == null ? null : (s.at(-1)[1] - p) * 100; };
  const spread = (a, b) => { // series of a - b in bp, on common dates
    const m = new Map(ser(b)); return ser(a).filter(([d]) => m.has(d)).map(([d, y]) => [d, +((y - m.get(d)) * 100).toFixed(2)]);
  };
  const spark = (pts) => {
    if (pts.length < 2) return "";
    const ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), r = hi - lo || 1;
    const d = pts.map((p, i) => `${(i / (pts.length - 1) * 100).toFixed(2)},${(28 - (p[1] - lo) / r * 26).toFixed(2)}`).join(" ");
    return `<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${d}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  };

  // ---------- tiles ----------
  function tiles() {
    const items = [1, 3, 5, 10, 30].map((t) => ({ k: t, name: `KTB ${lab(t)}`, s: ser(t), unit: "%" }))
      .concat([{ k: "s10_1", name: "10Y – 3Y", s: spread(10, 3), unit: "bp" }, { k: "s30_10", name: "30Y – 10Y", s: spread(30, 10), unit: "bp" }]);
    $("tiles").innerHTML = items.map((it) => {
      const s = it.s, last = s.at(-1)?.[1];
      const c = (days) => { if (!s.length) return null; const p = days === 1 ? s.at(-2)?.[1] : back(s, days); return p == null ? null : it.unit === "%" ? (last - p) * 100 : last - p; };
      const d1 = c(1), w = c(7), m = c(30);
      const v = last == null ? "–" : it.unit === "%" ? f2(last, 3) + "%" : f2(last, 1) + " bp";
      const s3 = s.slice(-66);
      return `<button class="tile" type="button" data-k="${it.k}" aria-pressed="${String(it.k) === String(st.hT)}"><b>${esc(it.name)}</b><span class="v">${v}</span><span class="c ${cls(d1)}">${bp(d1)} bp 1D</span><small>1W ${bp(w)} · 1M ${bp(m)} bp</small>${spark(s3)}</button>`;
    }).join("");
    $("tiles").querySelectorAll(".tile").forEach((b) => b.onclick = () => { st.hT = b.dataset.k; tiles(); hist(true); $("hH").scrollIntoView({ behavior: "smooth", block: "start" }); });
  }

  // ---------- curves ----------
  // One drawing routine for both curve panels. `c` describes a curve:
  //   { svg, tip, tab, now: legend <b> id, note, max, pts, ser(t), bonds (traded, with ttm/last/code/isin/name/curve/vs) }
  // KTB panel: KOFIA KTB curve with traded-KTB dots. Quasi-sovereign panel: the chosen issuer's curve with its bonds.
  function curveTable(c) {
    $(c.tab).innerHTML = TEN.map((t) => {
      const s = c.ser(t); if (!s.length) return "";
      const td = (v) => `<td class="${cls(v)}">${bp(v)}</td>`;
      return `<tr><td>${lab(t)}</td><td>${f2(s.at(-1)[1], 4)}</td>${td(chg(s, 1))}${td(chg(s, 7))}${td(chg(s, 30))}${td(chg(s, 365))}</tr>`;
    }).join("");
  }
  function cgbCurve() {
    return { svg: "cv", tip: "cvTip", tab: "cvTab", max: st.cvMax, pts: D.curve?.pts || [], ser, bonds: (D.bonds || []).filter((b) => b.last != null) };
  }
  function curveChart(c = cgbCurve()) {
    const svg = $(c.svg), W = Math.max(300, svg.clientWidth || 600), Hh = 320, P = { l: 44, r: 12, t: 12, b: 28 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const max = c.max, now = (c.pts || []).filter(([t]) => t <= max + 1e-9);
    const old = (days) => TEN.filter((t) => t <= max).map((t) => [t, back(c.ser(t), days)]).filter(([, y]) => y != null);
    const w1 = old(7), m1 = old(30);
    const dots = (c.bonds || []).filter((b) => b.last != null && b.ttm <= max);
    const ys = [...now, ...w1, ...m1].map((p) => p[1]).concat(dots.map((b) => b.last));
    if (!ys.length) { svg.innerHTML = ""; return dots; }
    let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad;
    const X = (t) => P.l + t / max * (W - P.l - P.r), Y = (y) => P.t + (hi - y) / (hi - lo) * (Hh - P.t - P.b);
    const line = (pts, col, w, dash = "") => pts.length > 1 ? `<polyline points="${pts.map(([t, y]) => `${X(t).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>` : "";
    let g = "";
    const step = (hi - lo) > 1.2 ? 0.25 : (hi - lo) > 0.5 ? 0.1 : 0.05;
    for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--line)" stroke-width="1"/><text x="${P.l - 6}" y="${Y(y) + 3.5}" text-anchor="end">${y.toFixed(2)}</text>`;
    const nar = W < 520, xt = max <= 10 ? (nar ? [0, 2, 5, 7, 10] : [0, 1, 2, 3, 5, 7, 10]) : max <= 30 ? (nar ? [0, 5, 10, 20, 30] : [0, 1, 2, 5, 7, 10, 15, 20, 30]) : (nar ? [0, 10, 20, 30, 40, 50] : [0, 1, 5, 10, 20, 30, 40, 50]);
    for (const t of xt) g += `<text x="${X(t)}" y="${Hh - 8}" text-anchor="middle">${t ? t + "Y" : "0"}</text>`;
    g += line(m1, "var(--c3)", 1.4, "4 3") + line(w1, "var(--c2)", 1.4, "4 3") + line(now, "var(--c1)", 2.4);
    g += dots.map((b, i) => `<circle cx="${X(b.ttm).toFixed(1)}" cy="${Y(b.last).toFixed(1)}" r="3" fill="var(--ink)" fill-opacity=".55" data-i="${i}"/>`).join("");
    g += `<line id="${c.svg}X" y1="${P.t}" y2="${Hh - P.b}" stroke="var(--muted)" stroke-dasharray="2 3" visibility="hidden"/><circle id="${c.svg}P" r="4" fill="var(--c1)" visibility="hidden"/>`;
    svg.innerHTML = g;
    const tip = $(c.tip), vx = svg.querySelector(`#${c.svg}X`), vp = svg.querySelector(`#${c.svg}P`);
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W / r.width, sy = (ev.clientY - r.top) * Hh / r.height;
      if (sx < P.l || sx > W - P.r) { leave(); return; }
      let best = null, bd = 9;
      dots.forEach((b) => { const d = Math.hypot(X(b.ttm) - sx, Y(b.last) - sy); if (d < bd) { bd = d; best = b; } });
      let html, px, py;
      if (best) {
        px = X(best.ttm); py = Y(best.last);
        html = `<b>${esc(best.code)}</b> ${esc(best.isin || "")}<br>${esc(best.name || "")}<br>Left ${f2(best.ttm)}Y · traded ${f2(best.last, 4)}%<br>Curve ${f2(best.curve, 4)}% · vs curve <span class="${cls(best.vs)}">${bp(best.vs)} bp</span>`;
      } else {
        const t = (sx - P.l) / (W - P.l - P.r) * max;
        let y = null; for (let i = 1; i < now.length; i++) if (t <= now[i][0]) { const [a, ya] = now[i - 1], [b, yb] = now[i]; y = ya + (yb - ya) * (t - a) / (b - a); break; }
        if (y == null) { leave(); return; }
        px = X(t); py = Y(y);
        html = `${t < 1 ? Math.round(t * 12) + "M" : t.toFixed(1) + "Y"} · <b>${y.toFixed(4)}%</b>`;
      }
      vx.setAttribute("x1", px); vx.setAttribute("x2", px); vx.setAttribute("visibility", "visible");
      vp.setAttribute("cx", px); vp.setAttribute("cy", py); vp.setAttribute("visibility", "visible");
      tip.innerHTML = html; tip.hidden = false;
      const left = px * r.width / W, top = py * r.height / Hh;
      tip.style.left = Math.min(Math.max(0, left + 12), r.width - tip.offsetWidth) + "px";
      tip.style.top = Math.max(0, top - tip.offsetHeight - 10) + "px";
    };
    const leave = () => { tip.hidden = true; vx.setAttribute("visibility", "hidden"); vp.setAttribute("visibility", "hidden"); };
    svg.onpointermove = move; svg.onpointerdown = move; svg.onpointerleave = leave;
    return dots;
  }
  function cgbPanel() {
    curveTable(cgbCurve());
    const dots = curveChart();
    $("lgNow").textContent = D.curve?.date ? `KOFIA KTB ${D.curve.date}` : "Latest";
    $("cvNote").textContent = `KOFIA final-quote KTB curve dated ${D.curve?.date || "–"} (15:30 Seoul close), joined smoothly between the 1, 2, 3, 5, 10, 20, 30 and 50-year benchmarks; below 1 year it runs to KOFIA's 91-day MSB quote. Dashed lines use KOFIA's closes at the benchmark tenors a week and a month earlier. Dots: ${dots.length} KTBs traded over the counter on ${D.tradeDay || "the latest session"} at their KOFIA weighted-average yield; hover or tap for issue code, ISIN and spread to the curve.`;
  }

  // ---------- policy bank curve (CDB / ADBC / EXIM) ----------
  const PBK = ["msb", "kdb", "ibk", "kexim"];
  const pbOk = (k) => !!D?.pb?.[k]?.curve?.pts?.length;
  function pbCurve() {
    const p = D.pb[st.pbK];
    return { svg: "pbcv", tip: "pbTip", tab: "pbTab", max: st.pbMax, pts: p.curve.pts, ser: (t) => p.tenors?.[t] || [], bonds: p.bonds || [] };
  }
  function pbPanel() {
    if (!pbOk(st.pbK)) st.pbK = PBK.find(pbOk) || st.pbK;
    const p = D?.pb?.[st.pbK], has = pbOk(st.pbK), end = has ? p.curve.pts.at(-1)[0] : 50;
    // ranges up to the curve's longest point (the quasi-sovereign curves are shorter than the KTB curve)
    const all = [[10, "0–10Y"], [30, "0–30Y"], [50, "0–50Y"]], cover = all.find(([m]) => m >= end - 1e-9) || all.at(-1);
    const rngs = all.filter(([m]) => m <= cover[0]);
    if (!rngs.some(([m]) => m === st.pbMax)) st.pbMax = rngs.at(-1)[0];
    $("pbRng").innerHTML = rngs.map(([m, l]) => `<button type="button" data-m="${m}" aria-pressed="${m === st.pbMax}"${has ? "" : " disabled"}>${l}</button>`).join("");
    $("pbRng").querySelectorAll("button").forEach((b) => b.onclick = () => { st.pbMax = +b.dataset.m; pbPanel(); });
    $("pbIss").innerHTML = PBK.map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === st.pbK}"${pbOk(k) ? "" : " disabled"} title="${esc(D?.pb?.[k]?.name || "")}">${esc(D?.pb?.[k]?.short || k.toUpperCase())}</button>`).join("");
    $("pbIss").querySelectorAll("button").forEach((b) => b.onclick = () => { st.pbK = b.dataset.k; pbPanel(); });
    if (!has) {
      $("pbcv").innerHTML = ""; $("pbTab").innerHTML = ""; $("pbNow").textContent = "Latest";
      $("pbNote").textContent = "This curve is not in the data yet. It is rebuilt after the KOFIA close each Seoul business day; check back shortly.";
      return;
    }
    $("pbH").textContent = `Quasi-sovereign yield curve · ${p.short}`;
    curveTable(pbCurve());
    const dots = curveChart(pbCurve());
    $("pbNow").textContent = `${p.fitted ? "Fitted" : "KOFIA"} ${p.short} ${p.curve.date}`;
    const fit = p.fit ? ` Today's fit: spread ${bp(p.fit.levelBp)} bp level, ${bp(p.fit.slopeBp)} bp short-end slope, from ${p.fit.n} trades.` : "";
    const k1 = st.pbK === "kdb" && p.kofia1y?.length ? ` KOFIA's own 1-year KDB quote: ${f2(p.kofia1y.at(-1)[1], 3)}%.` : "";
    $("pbNote").textContent = p.fitted
      ? `${p.name} (${p.kr}) curve dated ${p.curve.date}. KOFIA does not publish a full curve for this issuer, so the dashboard fits one: the KTB curve plus a Nelson-Siegel spread (level and short-end slope) fitted to the issuer's OTC trades over the last three sessions, volume-weighted, with outliers trimmed.${fit}${k1} Dashed lines are the same fit a week and a month earlier. Dots: ${dots.length} ${p.short} bonds traded OTC on ${D.pbTradeDay || "the latest session"}; hover or tap for code, ISIN and spread to the curve.`
      : `${p.name} (${p.kr}) curve from KOFIA's 91-day, 1-year and 2-year final quotes, dated ${p.curve.date}. MSBs are the Bank of Korea's own short-dated paper, so the gap to the KTB curve is the central bank's liquidity premium. Dashed lines are KOFIA's closes a week and a month earlier. Dots: ${dots.length} MSBs traded OTC on ${D.pbTradeDay || "the latest session"}; hover or tap for code, ISIN and spread to the curve.`;
  }

  // ---------- history ----------
  // Line keys: "t:<tenor>" a KOFIA KTB benchmark tenor, "b:<code>" a single KTB, "q:<iss>:<tenor>" a quasi-sovereign
  // curve tenor, "p:<iss>:<code>" a single MSB / KDB / IBK / KEXIM bond. Curves are kept by tenor, so a bond's
  // history is its issuer's curve on each day read (linear interpolation) at
  // the bond's remaining maturity that day, from its issue date. The tenor buttons set Line A; B–D add lines and a
  // spread-to-A chart.
  const bondCache = {};
  const pbTen = (k, t) => D?.pb?.[k]?.tenors?.[t] || [];
  // quasi-sovereign bonds: the register (every bond seen trading OTC in the last year) with the latest OTC yield where traded
  const pbList = (k) => { const p = D?.pb?.[k]; if (!p) return []; const last = new Map((p.bonds || []).map((b) => [b.code, b.last])); return (p.reg?.length ? p.reg : p.bonds || []).map((b) => ({ ...b, last: last.get(b.code) ?? null })); };
  const findB = (k, code) => k ? pbList(k).find((x) => x.code === code) : (D.bonds || []).find((x) => x.code === code);
  function bondSer(code, k = null) {
    const key = `${k || "cgb"}:${code}`;
    if (bondCache[key]) return bondCache[key];
    const b = findB(k, code); if (!b || !b.mat) return [];
    const get = (t) => k ? pbTen(k, t) : ser(t);
    const ts = TEN.filter((t) => get(t).length), maps = ts.map((t) => new Map(get(t))), mat = Date.parse(b.mat), out = [];
    for (const [d] of get(ts.at(-1) ?? 10)) {
      if (b.issue && d < b.issue) continue;
      const ttm = (mat - Date.parse(d)) / (365.25 * 864e5);
      const pts = ts.map((t, i) => [t, maps[i].get(d)]).filter(([, y]) => y != null);
      let y = null;
      if (pts.length && ttm <= pts[0][0]) y = pts[0][1];
      else for (let i = 0; i < pts.length - 1; i++) if (ttm >= pts[i][0] && ttm <= pts[i + 1][0]) { const [t0, y0] = pts[i], [t1, y1] = pts[i + 1]; y = y0 + (y1 - y0) * (ttm - t0) / (t1 - t0); break; }
      if (y != null) out.push([d, +y.toFixed(4)]);
    }
    return (bondCache[key] = out);
  }
  const parts = (k) => k.split(":"); // [kind, a, b]
  const bank = (k) => D?.pb?.[k]?.short || k.toUpperCase();
  const legSer = (k) => {
    if (!k) return [];
    const [x, a, c] = parts(k);
    return x === "t" ? ser(+a) : x === "b" ? bondSer(a) : x === "q" ? pbTen(a, c) : x === "p" ? bondSer(c, a) : [];
  };
  const legName = (k) => {
    if (!k) return "";
    const [x, a, c] = parts(k);
    if (x === "t") return `KTB ${lab(+a)}`;
    if (x === "q") return `${bank(a)} ${lab(+c)}`;
    const b = x === "p" ? findB(a, c) : findB(null, a), code = x === "p" ? c : a;
    return b ? `${x === "p" ? bank(a) + " " : ""}${b.code} ${b.name || ""}`.trim() : code;
  };
  const legShort = (k) => { const [x, a, c] = parts(k); return x === "t" ? `KTB ${lab(+a)}` : x === "b" ? a : x === "q" ? `${bank(a)} ${lab(+c)}` : `${bank(a)} ${c}`; };
  const isTraded = (k) => { const [x, a, c] = parts(k); return x === "b" ? findB(null, a)?.last != null : x === "p" ? findB(a, c)?.last != null : true; };
  // maturity sectors for the bond pickers (the "Maturity sector" menu narrows Lines A–D to one sector)
  const SECTORS = [[0, 2, "less than 2Y"], [2, 5, "2Y – 5Y"], [5, 10, "5Y – 10Y"], [10, 20, "10Y – 20Y"], [20, 30, "20Y – 30Y"], [30, 50.01, "30Y – 50Y"]];
  function legOptions(sel, none, tradedOnly) {
    const sec = st.hSec ? st.hSec.split("-").map(Number) : null;
    const inSec = (b) => !sec || (b.ttm >= sec[0] && b.ttm < sec[1]);
    const grp = SECTORS.filter(([lo]) => !sec || lo === sec[0]);
    const keep = (k, code) => sel === (k ? `p:${k}:${code}` : `b:${code}`); // the current pick stays listed
    const bonds = (D.bonds || []).filter((b) => b.mat && (!tradedOnly || b.last != null) && (inSec(b) || keep(null, b.code))).sort((a, b) => a.ttm - b.ttm);
    const o = (v, t) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`;
    const row = (b, pre) => `${pre}${b.code} · ${b.name || "–"} · ${b.coupon != null ? f2(b.coupon, 2) + "%" : b.type || "–"} · ${b.mat}${b.est ? " (est.)" : ""} · ${f2(b.ttm, 2)}Y${b.last != null ? ` · OTC ${f2(b.last, 3)}%` : ""}`;
    const banks = PBK.filter((k) => D?.pb?.[k]?.curve);
    return (none ? o("", "None") : "") +
      `<optgroup label="KTB · KOFIA benchmark tenors">${TEN.filter((t) => ser(t).length).map((t) => o(`t:${t}`, `KTB ${lab(t)} (KOFIA)`)).join("")}</optgroup>` +
      banks.map((k) => { const ts = TEN.filter((t) => pbTen(k, t).length); return ts.length ? `<optgroup label="${esc(bank(k))} curve tenors">${ts.map((t) => o(`q:${k}:${t}`, `${bank(k)} ${lab(t)} (${D.pb[k].fitted ? "fitted" : "KOFIA"} curve)`)).join("")}</optgroup>` : ""; }).join("") +
      grp.map(([lo, hi, l]) => { const g = bonds.filter((b) => (b.ttm >= lo && b.ttm < hi) || (sec && keep(null, b.code) && lo === sec[0] && !inSec(b))); return g.length ? `<optgroup label="KTB ${tradedOnly ? "traded OTC" : "bonds"}: ${l}">${g.map((b) => o(`b:${b.code}`, row(b, ""))).join("")}</optgroup>` : ""; }).join("") +
      banks.map((k) => { const all = pbList(k).filter((b) => b.mat && b.ttm > 0 && (!tradedOnly || b.last != null)).sort((a, b) => a.ttm - b.ttm);
        return grp.map(([lo, hi, l]) => { const g = all.filter((b) => (b.ttm >= lo && b.ttm < hi) || (sec && lo === sec[0] && keep(k, b.code) && !inSec(b))); return g.length ? `<optgroup label="${esc(bank(k))} ${tradedOnly ? "traded OTC" : "bonds"}: ${l}">${g.map((b) => o(`p:${k}:${b.code}`, row(b, bank(k) + " "))).join("")}</optgroup>` : ""; }).join(""); }).join("");
  }
  const tkey = (p) => { if (p?.time == null) return null; const t = p.time; return typeof t === "object" ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : t; };
  // Lines: A (set by tenor buttons/tiles), B, C, D. C and D list tenors plus only the bonds traded OTC in the latest session.
  const LEGS = [["hA", "A", "--c1"], ["hB", "B", "--c2"], ["hC", "C", "--c4"], ["hD", "D", "--c5"]];
  let ch = null, dc = null, dpad = null, mser = [], dser = [], hl = [], dl = [];
  const chartOpts = () => ({ layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--f-mono") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") }, crosshair: { mode: 1 } });
  function hLegends(k) {
    const row = (l, u) => { const v = k ? l.data.find(([d]) => d === k) : l.data.at(-1); return `<span><i style="background:${l.col};height:2.5px"></i>${esc(l.label)} <b>${v ? (u === "bp" ? bp(v[1]) + " bp" : f2(v[1], u === "bpS" ? 1 : 3) + (u === "bpS" ? " bp" : "%")) : "–"}</b><span class="mut">${v ? " " + v[0] : ""}</span></span>`; };
    $("hLeg").innerHTML = hl.map((l) => row(l, l.u)).join("");
    $("hDLeg").innerHTML = dl.map((l) => row(l, "bp")).join("");
  }
  function xh(chart, series, data, k) {
    if (!chart || !series) return;
    const v = k && data.find(([d]) => d === k);
    if (!v) { chart.clearCrosshairPosition?.(); return; }
    try { chart.setCrosshairPosition(v[1], k, series); } catch {}
  }
  function hist(fit) {
    const k = String(st.hT), isS = k.startsWith("s");
    if (!isS && k !== "bond") st.hA = `t:${k}`; // tenor buttons and tiles drive Line A
    for (const id of ["hC", "hD"]) if (st[id] && !isTraded(st[id])) st[id] = ""; // no longer traded today
    const days = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366 }[st.hR];
    // legs actually drawn: A always; B/C/D when set and different from A
    const legs = isS ? [{ id: "hA", L: "A", col: css("--accent"), key: k, s: k === "s10_1" ? spread(10, 3) : spread(30, 10) }]
      : LEGS.filter(([id]) => id === "hA" || (st[id] && st[id] !== st.hA)).map(([id, L, c]) => ({ id, L, col: css(c), key: st[id], s: legSer(st[id]) }));
    if (!isS && legs.length === 1) legs[0].col = css("--accent");
    const lastD = legs.map((l) => l.s.at(-1)?.[0]).filter(Boolean).sort().at(-1);
    const cut = lastD ? new Date(Date.parse(lastD) - days * 864e5).toISOString().slice(0, 10) : "";
    legs.forEach((l) => { l.v = l.s.filter(([d]) => d >= cut); });
    const A = legs[0], mA = new Map(A.v);
    const sprs = isS ? [] : legs.slice(1).map((l) => ({ label: `${legShort(l.key)} − ${legShort(A.key)}`, L: l.L, col: l.col, data: l.v.filter(([d]) => mA.has(d)).map(([d, y]) => [d, +((y - mA.get(d)) * 100).toFixed(1)]) }));
    const cmp = sprs.length > 0;
    $("hH").textContent = isS ? `${k === "s10_1" ? "10Y – 3Y" : "30Y – 10Y"} spread history (bp)` : `${legs.map((l) => legName(l.key)).join(" vs ")} yield history (%)`;
    $("hTen").innerHTML = TEN.filter((t) => ser(t).length).map((t) => `<button type="button" data-k="${t}" aria-pressed="${!isS && st.hA === `t:${t}`}">${lab(t)}</button>`).join("") + `<button type="button" data-k="s10_1" aria-pressed="${k === "s10_1"}">10Y–3Y</button><button type="button" data-k="s30_10" aria-pressed="${k === "s30_10"}">30Y–10Y</button>`;
    $("hTen").querySelectorAll("button").forEach((b) => b.onclick = () => { st.hT = b.dataset.k; tiles(); hist(true); });
    $("hRng").innerHTML = ["1M", "3M", "6M", "1Y"].map((r) => `<button type="button" aria-pressed="${r === st.hR}">${r}</button>`).join("");
    $("hRng").querySelectorAll("button").forEach((b) => b.onclick = () => { st.hR = b.textContent; hist(true); });
    $("hA").innerHTML = legOptions(isS ? "" : st.hA, false, false); $("hB").innerHTML = legOptions(st.hB, true, false);
    $("hC").innerHTML = legOptions(st.hC, true, true); $("hD").innerHTML = legOptions(st.hD, true, true);
    ["hA", "hB", "hC", "hD", "hSwap"].forEach((id) => { $(id).disabled = isS; });
    $("hA").onchange = (e) => { st.hA = e.target.value; st.hT = st.hA.startsWith("t:") ? st.hA.slice(2) : "bond"; tiles(); hist(true); };
    ["hB", "hC", "hD"].forEach((id) => { $(id).onchange = (e) => { st[id] = e.target.value; hist(true); }; });
    $("hSec").value = st.hSec; $("hSec").disabled = isS;
    $("hSec").onchange = (e) => { st.hSec = e.target.value; hist(true); };
    $("hSwap").onclick = () => { if (!st.hB) return; [st.hA, st.hB] = [st.hB, st.hA]; st.hT = st.hA.startsWith("t:") ? st.hA.slice(2) : "bond"; tiles(); hist(true); };
    if (window.LightweightCharts) {
      const o = chartOpts(), pf = { type: "price", precision: isS ? 1 : 3, minMove: isS ? 0.1 : 0.001 }, pf1 = { type: "price", precision: 1, minMove: 0.1 };
      if (!ch) {
        ch = LightweightCharts.createChart($("hist"), { ...o, autoSize: true, localization: { locale: "en-US" } });
        ch.subscribeCrosshairMove((p) => { const t = tkey(p); hLegends(t); xh(dc, dser[0], dl[0]?.data || [], t); });
        ch.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (dc && r) try { dc.timeScale().setVisibleLogicalRange(r); } catch {} });
      } else ch.applyOptions(o);
      mser.forEach((x) => ch.removeSeries(x)); mser = legs.map((l) => { const x = ch.addLineSeries({ color: l.col, lineWidth: 2, priceLineVisible: false, priceFormat: pf }); x.setData(l.v.map(([time, value]) => ({ time, value }))); return x; });
      if (fit) ch.timeScale().fitContent();
      $("hDWrap").style.display = cmp ? "" : "none";
      if (cmp) {
        if (!dc) {
          dc = LightweightCharts.createChart($("hDiff"), { ...o, autoSize: true, localization: { locale: "en-US" }, handleScroll: false, handleScale: false });
          dpad = dc.addLineSeries({ visible: false, priceLineVisible: false, lastValueVisible: false, priceFormat: pf1 });
          dc.subscribeCrosshairMove((p) => { const t = tkey(p); hLegends(t); xh(ch, mser[0], A.v, t); });
        } else dc.applyOptions(o);
        dser.forEach((x) => dc.removeSeries(x));
        // same dates as the main chart so the two x-axes line up bar for bar
        dpad.setData([...new Set(legs.flatMap((l) => l.v.map(([d]) => d)))].sort().map((time) => ({ time })));
        dser = sprs.map((sp, i) => { const x = dc.addLineSeries({ color: sp.col, lineWidth: 2, priceLineVisible: false, priceFormat: pf1 }); x.setData(sp.data.map(([time, value]) => ({ time, value }))); if (!i) x.createPriceLine({ price: 0, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" }); return x; });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const w = ch.priceScale("right").width(); if (w) dc.applyOptions({ rightPriceScale: { minimumWidth: w } });
          const r = ch.timeScale().getVisibleLogicalRange(); if (r) try { dc.timeScale().setVisibleLogicalRange(r); } catch {}
        }));
        $("hDH").textContent = sprs.length === 1 ? `Spread: ${sprs[0].label} (bp)` : `Spreads against Line A (${legShort(A.key)}), bp`;
      }
    }
    hl = legs.map((l) => ({ label: isS ? $("hH").textContent.replace(" history (bp)", "") : `${isS || legs.length === 1 ? "" : l.L + ": "}${legName(l.key)}`, data: l.v, col: l.col, u: isS ? "bpS" : "%" }));
    dl = sprs;
    hLegends(null);
    // stats boxes: single line or the 10Y–1Y / 30Y–10Y spread; with one comparison, that spread; with more, a table
    const stat = (S, sp) => { const ys = S.map((p) => p[1]), fmt = (x) => sp ? bp(x) + " bp" : f2(x, 3) + "%"; return { last: S.at(-1), chg: (S.at(-1)[1] - S[0][1]) * (sp ? 1 : 100), hi: fmt(Math.max(...ys)), lo: fmt(Math.min(...ys)), avg: fmt(ys.reduce((a, b) => a + b, 0) / ys.length), fmt }; };
    $("hSTab").style.display = sprs.length > 1 ? "" : "none";
    if (sprs.length > 1) {
      $("hStats").innerHTML = "";
      $("hSTab").querySelector("tbody").innerHTML = sprs.map((sp) => { if (!sp.data.length) return `<tr><td>${esc(sp.label)}</td><td colspan="5" class="mut">no common dates</td></tr>`; const t = stat(sp.data, true); return `<tr><td><i style="display:inline-block;width:10px;height:3px;background:${sp.col};vertical-align:middle;margin-right:6px"></i>${sp.L} − A · ${esc(sp.label)}</td><td><b>${bp(t.last[1])}</b></td><td class="${cls(t.chg)}">${bp(t.chg)}</td><td>${t.hi}</td><td>${t.lo}</td><td>${t.avg}</td></tr>`; }).join("");
    } else {
      const S = cmp ? sprs[0].data : A.v, sp = cmp || isS, pre = cmp ? "Spread " : "";
      if (S.length) { const t = stat(S, sp); $("hStats").innerHTML = [[`${pre}latest`, t.fmt(t.last[1]) + ` <small class="mut">${t.last[0]}</small>`], [`${pre}${st.hR} change`, `<span class="${cls(t.chg)}">${bp(t.chg)} bp</span>`], [`${pre}high`, t.hi], [`${pre}low`, t.lo], [`${pre}average`, t.avg]].map(([a, b]) => `<div>${a.charAt(0).toUpperCase() + a.slice(1)}<span>${b}</span></div>`).join(""); }
      else $("hStats").innerHTML = cmp ? `<div>Spread<span>no common dates</span></div>` : "";
    }
  }

  // ---------- bonds table ----------
  const BUCKETS = [[0, 1, "Up to 1 year"], [1, 3, "1 – 3 years"], [3, 5, "3 – 5 years"], [5, 7, "5 – 7 years"], [7, 10, "7 – 10 years"], [10, 20, "10 – 20 years"], [20, 30, "20 – 30 years"], [30, 99, "Over 30 years"]];
  const bucket = (t) => BUCKETS.findIndex(([, b]) => t <= b + 1e-9);
  // Table rows: KTBs plus MSB / KDB / IBK / KEXIM bonds (each issuer's register, with the latest OTC trade where
  // there is one), plus AAA bank debentures traded in the latest session. Built once per data load.
  const ISS = ["All", "KTB", "MSB", "KDB", "IBK", "KEXIM", "Bank"];
  const typeOf = (n = "") => /물가/.test(n) ? "Inflation-linked" : /할인|재정증권|할\d|\sDC\d/.test(n) ? "Discount" : /녹색|그린|ESG/.test(n) ? "Green" : "Coupon";
  const ageDays = (d) => d ? (Date.now() - Date.parse(d)) / 864e5 : 1e9;
  let allRows = null, allFor = null;
  function allBonds() {
    if (allFor === D && allRows) return allRows;
    const out = (D.bonds || []).map((b) => ({ ...b, iss: "KTB" }));
    for (const [k, p] of Object.entries(D.pb || {})) {
      const tr = new Map((p.bonds || []).map((b) => [b.code, b]));
      const seen = new Set();
      for (const r of [...(p.reg || []), ...(p.bonds || [])]) {
        if (!r?.code || seen.has(r.code)) continue; seen.add(r.code);
        const t = tr.get(r.code) || {};
        const o = { code: r.code, isin: r.isin || t.isin || null, name: r.name || t.name || null, type: typeOf(r.name || t.name), coupon: r.coupon ?? t.coupon ?? null, issue: r.issue || t.issue || null, mat: r.mat || t.mat || null, ttm: t.ttm ?? r.ttm, curve: t.curve ?? r.curve ?? null, last: t.last ?? null, wavg: t.wavg ?? null, amt: t.amt ?? null, chg: t.chg ?? null, vs: t.vs ?? null, iss: p.short || k.toUpperCase() };
        if (o.ttm == null || o.ttm <= 0) continue;
        out.push(o);
      }
    }
    // AAA bank debentures traded in the latest session, vs the fitted AAA bank curve
    for (const b of D.ncd?.bonds || []) if (b.ttm > 0) out.push({ ...b, type: "Bank debenture", coupon: null, issue: null, iss: "Bank" });
    out.forEach((b) => { b.isNew = ageDays(b.issue) <= 30; });
    allFor = D; return (allRows = out);
  }
  const COLS = [
    ["code", "Code", (b) => `<td class="code">${esc(b.code)}${b.isNew ? ` <span class="new" title="Issued ${esc(b.issue)}">New</span>` : ""}</td>`],
    ["isin", "ISIN", (b) => `<td>${esc(b.isin || "–")}</td>`],
    ["name", "Name", (b) => `<td class="nm" title="${esc(b.name)}">${esc(b.name || "–")}</td>`],
    ["iss", "Issuer", (b) => `<td><span class="is ${esc(b.iss)}">${esc(b.iss)}</span></td>`],
    ["type", "Type", (b) => `<td><span class="ty ${esc(b.type.split(" ")[0])}">${esc(b.type)}</span></td>`],
    ["coupon", "Coupon %", (b) => `<td>${b.type === "Discount" || b.coupon == null ? "–" : f2(b.coupon, 3)}</td>`],
    ["mat", "Maturity", (b) => `<td>${esc(b.mat || "–")}</td>`],
    ["ttm", "Left (Y)", (b) => `<td>${f2(b.ttm, 2)}</td>`],
    ["curve", "Curve %", (b) => `<td>${f2(b.curve, 3)}</td>`],
    ["last", "OTC avg %", (b) => `<td>${f2(b.last, 3)}</td>`],
    ["amt", "Traded KRW bn", (b) => `<td>${b.amt != null ? f2(b.amt / 1000, 1) : "–"}</td>`],
    ["chg", "Chg bp", (b) => `<td class="${cls(b.chg)}">${bp(b.chg, 2)}</td>`],
    ["vs", "vs curve bp", (b) => `<td class="${cls(b.vs)}">${bp(b.vs)}</td>`],
  ];
  function rows() {
    const q = st.q.trim().toLowerCase();
    return allBonds().filter((b) =>
      (!q || [b.code, b.isin, b.name].some((x) => String(x || "").toLowerCase().includes(q))) &&
      (st.iss === "All" || (st.iss === "New" ? b.isNew : b.iss === st.iss)) &&
      (st.type === "All" || b.type === st.type) &&
      (!st.mat || (() => { const [lo, hi] = st.mat.split("-").map(Number); return b.ttm >= lo && b.ttm < hi; })()) &&
      (!st.traded || b.last != null))
      .sort((a, b) => {
        const x = a[st.sort], y = b[st.sort];
        if (x == null && y == null) return a.ttm - b.ttm;
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * st.dir || a.ttm - b.ttm;
      });
  }
  function table() {
    const nNew = allBonds().filter((b) => b.isNew).length;
    $("bIss").innerHTML = [...ISS, ...(nNew ? ["New"] : [])].map((t) => `<button type="button" data-k="${t}" aria-pressed="${t === st.iss}">${t === "New" ? `New issues (${nNew})` : t}</button>`).join("");
    $("bIss").querySelectorAll("button").forEach((b) => b.onclick = () => { st.iss = b.dataset.k; table(); });
    $("bType").innerHTML = ["All", "Coupon", "Inflation-linked", "Green", "Discount", "Bank debenture"].filter((t) => t === "All" || allBonds().some((b) => b.type === t)).map((t) => `<button type="button" aria-pressed="${t === st.type}">${t}</button>`).join("");
    $("bType").querySelectorAll("button").forEach((b) => b.onclick = () => { st.type = b.textContent; table(); });
    $("bGrp").innerHTML = [["bucket", "By tenor"], ["none", "Ungrouped"]].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === st.grp}">${l}</button>`).join("");
    $("bGrp").querySelectorAll("button").forEach((b) => b.onclick = () => { st.grp = b.dataset.k; table(); });
    $("bHead").innerHTML = COLS.map(([k, l]) => `<th scope="col" data-k="${k}" ${st.sort === k ? `aria-sort="${st.dir > 0 ? "ascending" : "descending"}"` : ""} tabindex="0">${l}</th>`).join("");
    $("bHead").querySelectorAll("th").forEach((th) => { const go = () => { const k = th.dataset.k; st.dir = st.sort === k ? -st.dir : 1; st.sort = k; table(); }; th.onclick = go; th.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });
    const R = rows();
    const line = (b) => `<tr>${COLS.map((c) => c[2](b)).join("")}</tr>`;
    let html = "";
    if (!R.length) html = `<tr><td colspan="${COLS.length}" class="empty">No bonds match.</td></tr>`;
    else if (st.grp === "bucket") {
      const by = BUCKETS.map(() => []); R.forEach((b) => by[Math.max(0, bucket(b.ttm))].push(b));
      by.forEach((list, i) => {
        if (!list.length) return;
        const tr = list.filter((b) => b.vs != null), avg = tr.length ? tr.reduce((a, b) => a + b.vs, 0) / tr.length : null;
        html += `<tr class="g"><td colspan="${COLS.length}">${BUCKETS[i][2]}<span>${list.length} bonds · ${list.filter((b) => b.last != null).length} traded today${avg != null ? ` · avg vs curve ${bp(avg)} bp` : ""}</span></td></tr>` + list.map(line).join("");
      });
    } else html = R.map(line).join("");
    $("bBody").innerHTML = html;
    const all = allBonds(), n = (k) => all.filter((b) => b.iss === k).length;
    $("bNote").textContent = `${R.length} of ${all.length} bonds shown (KTB ${n("KTB")}, MSB ${n("MSB")}, KDB ${n("KDB")}, IBK ${n("IBK")}, KEXIM ${n("KEXIM")}, bank debentures ${n("Bank")}) · ${all.filter((b) => b.last != null).length} traded over the counter on ${D.tradeDay || "the latest session"} · ${nNew} first seen trading in the last 30 days, tagged New. The register is every bond seen trading OTC in KOFIA's daily trade reports over the last year, so a bond that has not traded for a year is missing. KTBs are compared with the KOFIA KTB curve, MSBs with KOFIA's MSB quotes, and KDB, IBK, KEXIM and AAA bank debentures with their fitted issuer curves. "OTC avg" is KOFIA's volume-weighted average traded yield for the session; "Chg" is against the bond's own average in the previous session it traded. Maturities come from KOFIA's remaining term. Click a column header to sort.`;
  }
  $("bQ").oninput = (e) => { st.q = e.target.value; table(); };
  $("bTr").onchange = (e) => { st.traded = e.target.checked; table(); };
  $("bMat").onchange = (e) => { st.mat = e.target.value; table(); };
  $("bDl").onclick = () => {
    const head = ["code", "isin", "name", "issuer", "type", "coupon_pct", "first_seen", "maturity", "years_left", "curve_pct", "otc_avg_pct", "traded_krw_bn", "chg_bp", "vs_curve_bp"];
    const q = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    const body = rows().map((b) => [b.code, b.isin, b.name, b.iss, b.type, b.coupon, b.issue, b.mat, b.ttm, b.curve, b.last, b.amt != null ? +(b.amt / 1000).toFixed(2) : null, b.chg, b.vs].map(q).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `korea-bonds-by-code-isin-${D.curve?.date || "latest"}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  function rngButtons() {
    $("cvRng").innerHTML = [[10, "0–10Y"], [30, "0–30Y"], [50, "0–50Y"]].map(([m, l]) => `<button type="button" data-m="${m}" aria-pressed="${m === st.cvMax}">${l}</button>`).join("");
    $("cvRng").querySelectorAll("button").forEach((b) => b.onclick = () => { st.cvMax = +b.dataset.m; rngButtons(); curveChart(); });
  }
  function render(first) {
    tiles(); rngButtons(); cgbPanel(); pbPanel(); hist(first); table();
    const upd = D.updated ? new Date(D.updated * 1000).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }) : "–";
    const bs = $("bSub"); if (bs) { bs.dataset.base ||= bs.innerHTML;
      const tt = D.tradeDay ? ` · KOFIA OTC trades to the ${D.tradeDay} Seoul close` : "";
      bs.innerHTML = `<b>Last updated ${esc(upd)} SGT${esc(tt)}</b><br>${bs.dataset.base}`; }
    $("lede").innerHTML = `Korea Treasury Bond (KTB) yields from KOFIA, the Korea Financial Investment Association, whose 15:30 final quotes are the market's official close; curves for the Bank of Korea's Monetary Stabilisation Bonds and the three state policy banks (KDB, IBK, KEXIM); and KTBs by issue code and ISIN with their over-the-counter traded yields. Latest KOFIA close: <b>${esc(D.curve?.date || "–")}</b>. Data refreshed ${esc(upd)} Singapore time; the page re-checks every minute.`;
  }
  async function load(first) {
    try {
      const r = await fetch(`${SRC}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (!first && D && j.updated === D.updated) return;
      D = j; for (const key in bondCache) delete bondCache[key]; render(first);
    } catch (e) { if (first) $("lede").textContent = "Korea bond data is not available yet. It is rebuilt after each KOFIA close; check back in a few minutes."; }
  }
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => D && (curveChart(), pbPanel()), 120); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => D && (curveChart(), pbPanel(), hist(false)));
  load(true); setInterval(() => load(false), 60000);
})();
