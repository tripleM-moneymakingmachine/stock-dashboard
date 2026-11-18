// Malaysia tab: the MGS curve from Bank Negara Malaysia's FAST consolidated indicative yields, the GII (Islamic) and
// corporate AAA–BBB curves, tenor history, and MGS / GII by stock code and ISIN. Port of the Indonesia tab
// (assets/indonesia.js). Reads ../data/malaysia.json (written by scripts/fetch-malaysia.mjs) and re-checks it every minute.
(() => {
  const SRC = "../data/malaysia.json";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const TEN = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30];
  const lab = (t) => t < 1 ? `${Math.round(t * 12)}M` : `${t}Y`;
  const f2 = (v, n = 2) => v == null || !isFinite(v) ? "–" : (+v).toFixed(n);
  const bp = (v, n = 1) => v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(+v).toFixed(n)}`;
  const cls = (v) => v == null || !isFinite(v) || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down"; // yields up = green, as on the Macro tab
  let D = null;
  const st = { cvMax: 30, pbMax: 30, pbK: "gii", hT: 10, hR: "6M", hA: "t:10", hB: "", hC: "", hD: "", hSec: "", q: "", iss: "All", type: "All", mat: "", grp: "bucket", traded: false, sort: "ttm", dir: 1 };

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
    const items = [3, 5, 7, 10, 20].map((t) => ({ k: t, name: `MGS ${lab(t)}`, s: ser(t), unit: "%" }))
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
  // MGS panel: the FAST MGS curve with every MGS's indicative yield as a dot. GII / credit panel: the chosen curve with its bonds.
  function curveTable(c) {
    $(c.tab).innerHTML = TEN.map((t) => {
      const s = c.ser(t); if (!s.length) return "";
      const td = (v) => `<td class="${cls(v)}">${bp(v)}</td>`;
      return `<tr><td>${lab(t)}</td><td>${f2(s.at(-1)[1], 4)}</td>${td(chg(s, 1))}${td(chg(s, 7))}${td(chg(s, 30))}${td(chg(s, 365))}</tr>`;
    }).join("");
  }
  function cgbCurve() {
    return { svg: "cv", tip: "cvTip", tab: "cvTab", max: st.cvMax, pts: D.curve?.pts || [], ser, bonds: (D.bonds || []).filter((b) => b.last != null && b.ttm >= 0.5) }; // bonds about to mature trade off the curve
  }
  function curveChart(c = cgbCurve()) {
    const svg = $(c.svg), W = Math.max(300, svg.clientWidth || 600), Hh = 320, P = { l: 44, r: 12, t: 12, b: 28 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const max = c.max, now = (c.pts || []).filter(([t]) => t <= max + 1e-9);
    const old = (days) => TEN.filter((t) => t <= max).map((t) => [t, back(c.ser(t), days)]).filter(([, y]) => y != null);
    const full = (pts) => pts.length >= Math.max(4, TEN.filter((t) => t <= max && c.ser(t).length).length * 0.6) ? pts : []; // until enough days are stored, skip partial comparison curves
    const w1 = full(old(7)), m1 = full(old(30));
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
    $("lgNow").textContent = D.curve?.date ? `FAST MGS ${D.curve.date}` : "Latest";
    const hist0 = (D.igsDays || [])[0];
    $("cvNote").textContent = `MGS yield curve dated ${D.curve?.date || "–"} from Bank Negara Malaysia's FAST "consolidated indicative yield-to-maturity": the average of the yields the principal dealers contribute each business day for 1–10, 15, 20 and 30 years, joined smoothly here. Dashed lines are the curve a week and a month earlier${hist0 ? ` (daily history stored since ${hist0})` : ""}. Dots: ${dots.length} MGS at their FAST indicative yield (BNM's MGS Indicative Price list); hover or tap for stock code, ISIN and spread to the curve.`;
  }

  // ---------- GII and corporate curves ----------
  const PBK = ["gii", "khazanah", "cagamas", "aaa", "aa1", "aa", "aa3", "a1", "a", "a3", "bbb"];
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
      $("pbNote").textContent = "This curve is not in the data yet. It is rebuilt after FAST publishes each Kuala Lumpur business day; check back shortly.";
      return;
    }
    $("pbH").textContent = `GII and credit curves · ${p.short}`;
    curveTable(pbCurve());
    const dots = curveChart(pbCurve());
    $("pbNow").textContent = `FAST ${p.short} ${p.curve.date}`;
    $("pbNote").textContent = st.pbK === "gii"
      ? `${p.name} curve dated ${p.curve.date}: FAST's consolidated indicative yields for Government Securities (Islamic), 1–20 years. GII usually trade a few bp above MGS of the same tenor, a liquidity premium that narrows when Islamic banks and funds buy. Dashed lines are the curve a week and a month earlier. Dots: ${dots.length} GII that traded on Bursa Malaysia Bonds' ETP on the latest day, at their closing yield; hover or tap for stock code, ISIN and spread to the GII curve.`
      : `${p.name} curve dated ${p.curve.date}, from FAST's consolidated indicative yields by rating (3, 5, 7, 10 and 15 years). The gap to the MGS curve at each tenor is the credit spread. Dashed lines are the curve a week and a month earlier.`;
  }

  // ---------- history ----------
  // Line keys: "t:<tenor>" an MGS tenor, "b:<code>" a single MGS or GII, "q:<iss>:<tenor>" a GII / corporate curve
  // tenor, "p:<iss>:<code>" a single GII. Curves are kept by tenor, so a bond's
  // history is its issuer's curve on each day read (linear interpolation) at
  // the bond's remaining maturity that day, from its issue date. The tenor buttons set Line A; B–D add lines and a
  // spread-to-A chart.
  const bondCache = {};
  const pbTen = (k, t) => D?.pb?.[k]?.tenors?.[t] || [];
  // GII that traded on the latest day
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
    if (x === "t") return `MGS ${lab(+a)}`;
    if (x === "q") return `${bank(a)} ${lab(+c)}`;
    const b = x === "p" ? findB(a, c) : findB(null, a), code = x === "p" ? c : a;
    return b ? `${x === "p" ? bank(a) + " " : ""}${b.code} ${b.name || ""}`.trim() : code;
  };
  const legShort = (k) => { const [x, a, c] = parts(k); return x === "t" ? `MGS ${lab(+a)}` : x === "b" ? a : x === "q" ? `${bank(a)} ${lab(+c)}` : `${bank(a)} ${c}`; };
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
    const row = (b, pre) => `${pre}${b.code} · ${b.name || "–"} · ${b.coupon != null ? f2(b.coupon, 2) + "%" : b.type || "–"} · ${b.mat}${b.est ? " (est.)" : ""} · ${f2(b.ttm, 2)}Y${b.last != null ? ` · ${f2(b.last, 3)}%` : ""}`;
    const banks = PBK.filter((k) => D?.pb?.[k]?.curve);
    return (none ? o("", "None") : "") +
      `<optgroup label="MGS · FAST curve tenors">${TEN.filter((t) => ser(t).length).map((t) => o(`t:${t}`, `MGS ${lab(t)} (FAST curve)`)).join("")}</optgroup>` +
      banks.map((k) => { const ts = TEN.filter((t) => pbTen(k, t).length); return ts.length ? `<optgroup label="${esc(bank(k))} curve tenors">${ts.map((t) => o(`q:${k}:${t}`, `${bank(k)} ${lab(t)} (FAST curve)`)).join("")}</optgroup>` : ""; }).join("") +
      grp.map(([lo, hi, l]) => { const g = bonds.filter((b) => (b.ttm >= lo && b.ttm < hi) || (sec && keep(null, b.code) && lo === sec[0] && !inSec(b))); return g.length ? `<optgroup label="MGS and GII${tradedOnly ? " with a yield today" : ""}: ${l}">${g.map((b) => o(`b:${b.code}`, row(b, ""))).join("")}</optgroup>` : ""; }).join("") +
      banks.map((k) => { const all = pbList(k).filter((b) => b.mat && b.ttm > 0 && (!tradedOnly || b.last != null)).sort((a, b) => a.ttm - b.ttm);
        return grp.map(([lo, hi, l]) => { const g = all.filter((b) => (b.ttm >= lo && b.ttm < hi) || (sec && lo === sec[0] && keep(k, b.code) && !inSec(b))); return g.length ? `<optgroup label="${esc(bank(k))} ${tradedOnly ? "traded today" : "series"}: ${l}">${g.map((b) => o(`p:${k}:${b.code}`, row(b, bank(k) + " "))).join("")}</optgroup>` : ""; }).join(""); }).join("");
  }
  const tkey = (p) => { if (p?.time == null) return null; const t = p.time; return typeof t === "object" ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : t; };
  // Lines: A (set by tenor buttons/tiles), B, C, D. C and D list tenors plus only the bonds with a yield on the latest day.
  const LEGS = [["hA", "A", "--c1"], ["hB", "B", "--c2"], ["hC", "C", "--c4"], ["hD", "D", "--c5"]];
  let ch = null, dc = null, dpad = null, mser = [], dser = [], hl = [], dl = [], iser = [];
  // MYR IRS overlay (data/malaysia-irs.json): dashed lines on the yield chart, swap spreads in the spread chart and table
  const IRS_T = [1, 3, 5, 7, 10];
  let IRS = null;
  st.irs = IRS_T.map(String); st.irsSp = "mgs";
  const irsSer = (t) => IRS?.tenors?.[t] || [];
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
  // swap spread table: every IRS tenor against MGS at the same tenor and against Line A, over the chart's range
  function irsTable(A, cut) {
    const w = $("hIrsWrap"); if (!w) return;
    if (!IRS) { w.style.display = "none"; return; }
    w.style.display = "";
    const mA = new Map(A?.s || []), lastA = A?.s?.at(-1);
    const back = (s, days) => { if (!s.length) return null; const c = new Date(Date.parse(s.at(-1)[0]) - days * 864e5).toISOString().slice(0, 10); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= c) return s[i][1]; return null; };
    const rows = IRS_T.map((t) => {
      const ir = irsSer(t), mg = new Map(ser(t)); if (!ir.length) return "";
      const sp = ir.filter(([d]) => mg.has(d)).map(([d, y]) => [d, (y - mg.get(d)) * 100]);
      const L = sp.at(-1), inR = sp.filter(([d]) => d >= cut).map((x) => x[1]);
      const ch = (n) => { const p = n === 1 ? sp.at(-2)?.[1] : back(sp, n); return L && p != null ? L[1] - p : null; };
      const avg = inR.length ? inR.reduce((a, b) => a + b, 0) / inR.length : null, pct = inR.length && L ? Math.round(inR.filter((x) => x <= L[1]).length / inR.length * 100) : null;
      const irA = ir.filter(([d]) => mA.has(d)).at(-1), vsA = irA ? (irA[1] - mA.get(irA[0])) * 100 : null;
      const sel = st.irs.includes(String(t));
      return `<tr${sel ? "" : ' class="mut"'}><td><i style="display:inline-block;width:12px;height:0;border-top:2px dashed var(--i${t});vertical-align:middle;margin-right:6px"></i>${t}Y</td><td>${f2(ir.at(-1)[1], 3)}</td><td>${L ? f2(mg.get(L[0]), 3) : "–"}</td><td class="${cls(L?.[1])}"><b>${L ? bp(L[1]) : "–"}</b></td><td class="${cls(ch(1))}">${bp(ch(1))}</td><td class="${cls(ch(7))}">${bp(ch(7))}</td><td class="${cls(ch(30))}">${bp(ch(30))}</td><td>${avg != null ? bp(avg) : "–"}</td><td>${inR.length ? bp(Math.max(...inR)) : "–"}</td><td>${inR.length ? bp(Math.min(...inR)) : "–"}</td><td>${pct != null ? pct + "%" : "–"}</td><td class="${cls(vsA)}">${bp(vsA)}</td></tr>`;
    }).join("");
    $("hIrsTab").querySelector("tbody").innerHTML = rows;
    $("hIrsNote").textContent = `Swap spread = MYR IRS (fixed vs 3-month KLIBOR, Hong Leong Bank's daily closes) minus the FAST MGS yield at the same tenor, in bp, on days both exist; negative means swaps pay less than MGS. Changes are over 1 day, 1 week and 1 month; average, high, low and percentile cover the chart's range (${st.hR}). "vs Line A" is each IRS minus the line now in Line A (${A ? legShort(A.key) : "–"}${lastA ? ", " + lastA[0] : ""}). Click the IRS buttons above to show or hide a tenor on the charts.`;
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
    // IRS overlays and their spreads: IRS − MGS at the same tenor (swap spread), or IRS − Line A
    const irsL = isS || !IRS ? [] : st.irs.map(Number).sort((a, b) => a - b).map((t) => ({ t, label: `MYR IRS ${t}Y`, col: css(`--i${t}`), v: irsSer(t).filter(([d]) => d >= cut) })).filter((x) => x.v.length);
    const irsD = irsL.map((x) => { const m = st.irsSp === "a" ? mA : new Map(ser(x.t)); return { label: st.irsSp === "a" ? `IRS ${x.t}Y − ${legShort(A.key)}` : `IRS ${x.t}Y − MGS ${x.t}Y`, col: x.col, dash: true, data: x.v.filter(([d]) => m.has(d)).map(([d, y]) => [d, +((y - m.get(d)) * 100).toFixed(1)]) }; });
    const allD = [...sprs, ...irsD];
    const cmp = sprs.length > 0, cmpAny = allD.length > 0;
    $("hIrs").innerHTML = IRS_T.map((t) => `<button type="button" data-k="${t}" aria-pressed="${st.irs.includes(String(t))}"${IRS && !isS ? "" : " disabled"}><i class="hsw" style="background:var(--i${t})"></i>${t}Y</button>`).join("") + `<button type="button" data-k="all">All</button><button type="button" data-k="none">None</button>`;
    $("hIrs").querySelectorAll("button").forEach((b) => b.onclick = () => { const k = b.dataset.k; st.irs = k === "all" ? IRS_T.map(String) : k === "none" ? [] : st.irs.includes(k) ? st.irs.filter((x) => x !== k) : [...st.irs, k]; hist(false); });
    $("hIrsSp").innerHTML = [["mgs", "IRS − MGS same tenor"], ["a", "IRS − Line A"]].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${st.irsSp === k}"${IRS && !isS ? "" : " disabled"}>${l}</button>`).join("");
    $("hIrsSp").querySelectorAll("button").forEach((b) => b.onclick = () => { st.irsSp = b.dataset.k; hist(false); });
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
      iser.forEach((x) => ch.removeSeries(x)); iser = irsL.map((l) => { const x = ch.addLineSeries({ color: l.col, lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: pf }); x.setData(l.v.map(([time, value]) => ({ time, value }))); return x; });
      if (fit) ch.timeScale().fitContent();
      $("hDWrap").style.display = cmpAny ? "" : "none";
      if (cmpAny) {
        if (!dc) {
          dc = LightweightCharts.createChart($("hDiff"), { ...o, autoSize: true, localization: { locale: "en-US" }, handleScroll: false, handleScale: false });
          dpad = dc.addLineSeries({ visible: false, priceLineVisible: false, lastValueVisible: false, priceFormat: pf1 });
          dc.subscribeCrosshairMove((p) => { const t = tkey(p); hLegends(t); xh(ch, mser[0], A.v, t); });
        } else dc.applyOptions(o);
        dser.forEach((x) => dc.removeSeries(x));
        // same dates as the main chart so the two x-axes line up bar for bar
        dpad.setData([...new Set([...legs, ...irsL].flatMap((l) => l.v.map(([d]) => d)))].sort().map((time) => ({ time })));
        dser = allD.map((sp, i) => { const x = dc.addLineSeries({ color: sp.col, lineWidth: 2, lineStyle: sp.dash ? 2 : 0, priceLineVisible: false, priceFormat: pf1 }); x.setData(sp.data.map(([time, value]) => ({ time, value }))); if (!i) x.createPriceLine({ price: 0, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" }); return x; });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const w = ch.priceScale("right").width(); if (w) dc.applyOptions({ rightPriceScale: { minimumWidth: w } });
          const r = ch.timeScale().getVisibleLogicalRange(); if (r) try { dc.timeScale().setVisibleLogicalRange(r); } catch {}
        }));
        $("hDH").textContent = !irsD.length ? (sprs.length === 1 ? `Spread: ${sprs[0].label} (bp)` : `Spreads against Line A (${legShort(A.key)}), bp`)
          : `Spreads, bp: ${[sprs.length ? `Lines B–D − A (solid)` : "", st.irsSp === "a" ? `MYR IRS − Line A (dashed)` : `MYR IRS − MGS at the same tenor, the swap spread (dashed)`].filter(Boolean).join(" · ")}`;
      }
    }
    hl = legs.map((l) => ({ label: isS ? $("hH").textContent.replace(" history (bp)", "") : `${isS || legs.length === 1 ? "" : l.L + ": "}${legName(l.key)}`, data: l.v, col: l.col, u: isS ? "bpS" : "%" }));
    hl = hl.concat(irsL.map((l) => ({ label: l.label, data: l.v, col: l.col, u: "%" })));
    dl = allD;
    hLegends(null);
    irsTable(A, cut);
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
  // Table rows: every MGS and GII the dashboard has seen on FAST's MGS Indicative Price list or on the ETP (indicative
  // yield for MGS, the day's ETP close where it traded), plus the financial and SOE bonds and sukuk from BIX Malaysia
  // (data/malaysia-credit.json: last traded yield, rating, issuer). Built once per data load.
  const ISS = ["All", "MGS", "GII", "Financial", "SOE"];
  const ageDays = (d) => d ? (Date.now() - Date.parse(d)) / 864e5 : 1e9;
  let allRows = null, allFor = null, CR = null;
  const linF = (pts) => (t) => { if (!pts?.length) return null; if (t <= pts[0][0]) return pts[0][1]; for (let i = 0; i < pts.length - 1; i++) if (t <= pts[i + 1][0]) { const [a, y0] = pts[i], [b, y1] = pts[i + 1]; return y0 + (y1 - y0) * (t - a) / (b - a); } return pts.at(-1)[1]; };
  function allBonds() {
    if (allFor === D && allRows) return allRows;
    const mgsAt = linF(D.curve?.pts), etp = D.etpDay || D.tradeDay;
    const out = (D.bonds || []).map((b) => ({ ...b, iss: b.iss || "MGS", type: b.type || "MGS", issuer: "Government of Malaysia", rating: "Sovereign", ld: b.trd != null ? etp : null,
      vsMgs: b.iss === "MGS" ? b.vs : b.last != null && b.ttm >= 1 && mgsAt(b.ttm) != null ? +((b.last - mgsAt(b.ttm)) * 100).toFixed(1) : null }));
    out.forEach((b) => { b.isNew = ageDays(b.issue) <= 30; });
    const day = D.tradeDay;
    for (const c of CR?.bonds || []) {
      if (!c.mat || c.ttm == null || c.ttm <= 0) continue;
      const today = c.ld && c.ld >= day;
      out.push({ code: c.code || `BIX ${c.sbid}`, isin: c.isin || null, name: c.name, iss: c.cat, type: c.instrument || "Bond", issuer: c.issuerShort || c.issuer, issuerFull: c.issuer, rating: c.rating || "–",
        coupon: c.coupon, issue: c.issue || null, mat: c.mat, ttm: c.ttm, out: c.out != null ? c.out * 1e6 : null, curve: c.curve, ref: c.ref, last: c.ly ?? null, ld: c.ld || null,
        trd: today ? c.ly : null, vol: today ? c.lamt : null, chg: c.py != null && c.ly != null ? +((c.ly - c.py) * 100).toFixed(1) : null, vs: c.vs, vsMgs: c.vsMgs, sbid: c.sbid, isNew: ageDays(c.issue) <= 30 });
    }
    allFor = D; return (allRows = out);
  }
  const COLS = [
    ["code", "Stock code", (b) => `<td class="code">${b.sbid ? `<a href="https://bixmalaysia.com/security-info-page?SBid=${b.sbid}" target="_blank" rel="noopener">${esc(b.code)}</a>` : esc(b.code)}${b.bench ? ` <span class="new" title="BNM benchmark">BM</span>` : ""}${b.isNew ? ` <span class="new" title="Issued or first seen ${esc(b.issue)}">New</span>` : ""}</td>`],
    ["isin", "ISIN", (b) => `<td>${esc(b.isin || "–")}</td>`],
    ["name", "Name", (b) => `<td class="nm" title="${esc(b.name)}">${esc(b.name || "–")}</td>`],
    ["iss", "Category", (b) => `<td><span class="is ${esc(b.iss)}">${esc(b.iss)}</span></td>`],
    ["issuer", "Issuer", (b) => `<td class="nm" title="${esc(b.issuerFull || b.issuer || "")}">${esc(b.issuer || "–")}</td>`],
    ["rating", "Rating", (b) => `<td>${esc(b.rating || "–")}</td>`],
    ["coupon", "Coupon %", (b) => `<td>${f2(b.coupon, 3)}</td>`],
    ["mat", "Maturity", (b) => `<td>${esc(b.mat || "–")}</td>`],
    ["ttm", "Left (Y)", (b) => `<td>${f2(b.ttm, 2)}</td>`],
    ["curve", "Curve %", (b) => `<td title="${esc(b.ref ? "Reference: " + b.ref : b.iss === "GII" ? "Reference: FAST GII curve" : "Reference: FAST MGS curve")}">${f2(b.curve, 3)}</td>`],
    ["last", "Yield %", (b) => `<td>${f2(b.last, 3)}</td>`],
    ["ld", "Last trade", (b) => `<td>${esc(b.ld || "–")}</td>`],
    ["trd", "Traded today %", (b) => `<td>${f2(b.trd, 2)}</td>`],
    ["vol", "Traded RM m", (b) => `<td>${b.vol != null ? f2(b.vol, 1) : "–"}</td>`],
    ["out", "Outstanding RM bn", (b) => `<td>${b.out != null ? f2(b.out / 1e9, 2) : "–"}</td>`],
    ["chg", "Chg bp", (b) => `<td class="${cls(b.chg)}">${bp(b.chg, 1)}</td>`],
    ["vs", "vs curve bp", (b) => `<td class="${cls(b.vs)}">${bp(b.vs)}</td>`],
    ["vsMgs", "vs MGS bp", (b) => `<td class="${cls(b.vsMgs)}">${bp(b.vsMgs)}</td>`],
  ];
  function rows() {
    const q = st.q.trim().toLowerCase();
    return allBonds().filter((b) =>
      (!q || [b.code, b.isin, b.name, b.issuer, b.issuerFull].some((x) => String(x || "").toLowerCase().includes(q))) &&
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
    const types = [...new Set(allBonds().map((b) => b.type))].sort();
    $("bType").innerHTML = ["All", ...types].map((t) => `<button type="button" aria-pressed="${t === st.type}">${esc(t)}</button>`).join("");
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
        html += `<tr class="g"><td colspan="${COLS.length}">${BUCKETS[i][2]}<span>${list.length} bonds · ${list.filter((b) => b.last != null).length} with a yield${avg != null ? ` · avg vs curve ${bp(avg)} bp` : ""}</span></td></tr>` + list.map(line).join("");
      });
    } else html = R.map(line).join("");
    $("bBody").innerHTML = html;
    const all = allBonds(), n = (k) => all.filter((b) => b.iss === k).length;
    $("bNote").textContent = `${R.length} of ${all.length} bonds shown (MGS ${n("MGS")}, GII ${n("GII")}, Financial ${n("Financial")}, SOE ${n("SOE")}) · ${all.filter((b) => b.trd != null).length} traded on ${D.etpDay || D.tradeDay || "the latest day"} · ${nNew} new in the last 30 days; BM marks BNM's benchmark issues. MGS come from FAST's MGS Indicative Price list (Bank Negara Malaysia); GII once they trade on Bursa Malaysia Bonds' ETP. Financial (banks, Cagamas, insurers, finance companies) and SOE (government-linked and statutory issuers such as DanaInfra, Prasarana, PTPTN, LPPSA, Khazanah and the development banks) bonds and sukuk come from BIX Malaysia, which shows each issuer's most recently traded bonds with rating, last trade and amount outstanding; the dashboard keeps every bond it has seen, so the list grows day by day, and stock code and ISIN are read from each bond's BIX page (click a stock code to open it). "Curve" is the bond's reference curve at its remaining term: FAST MGS for MGS, FAST GII for GII, FAST's Cagamas and Khazanah curves for those issuers, FAST's curve for the bond's rating, and MGS for government-guaranteed and unrated SOE bonds (hover for which). "Yield" is the MGS indicative yield, or the last traded yield for everything else (see "Last trade"); spreads are shown only for trades in the last 30 days. "Chg" is against the previous indicative day (MGS) or the previous trade. Click a column header to sort.`;
  }
  $("bQ").oninput = (e) => { st.q = e.target.value; table(); };
  $("bTr").onchange = (e) => { st.traded = e.target.checked; table(); };
  $("bMat").onchange = (e) => { st.mat = e.target.value; table(); };
  $("bDl").onclick = () => {
    const head = ["stock_code", "isin", "name", "category", "issuer", "rating", "coupon_pct", "issue_or_first_seen", "maturity", "years_left", "outstanding_rm_bn", "curve_pct", "yield_pct", "last_trade", "traded_today_pct", "traded_rm_m", "chg_bp", "vs_curve_bp", "vs_mgs_bp"];
    const q = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    const body = rows().map((b) => [b.code, b.isin, b.name, b.iss, b.issuerFull || b.issuer, b.rating, b.coupon, b.issue, b.mat, b.ttm, b.out != null ? +(b.out / 1e9).toFixed(3) : null, b.curve, b.last, b.ld, b.trd, b.vol, b.chg, b.vs, b.vsMgs].map(q).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `malaysia-bonds-by-code-isin-${D.curve?.date || "latest"}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  function rngButtons() {
    $("cvRng").innerHTML = [[5, "0–5Y"], [10, "0–10Y"], [30, "0–30Y"]].map(([m, l]) => `<button type="button" data-m="${m}" aria-pressed="${m === st.cvMax}">${l}</button>`).join("");
    $("cvRng").querySelectorAll("button").forEach((b) => b.onclick = () => { st.cvMax = +b.dataset.m; rngButtons(); curveChart(); });
  }
  function render(first) {
    tiles(); rngButtons(); cgbPanel(); pbPanel(); hist(first); table();
    const upd = D.updated ? new Date(D.updated * 1000).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }) : "–";
    const bs = $("bSub"); if (bs) { bs.dataset.base ||= bs.innerHTML;
      const tt = D.tradeDay ? ` · FAST indicative yields for ${D.tradeDay}` : "";
      bs.innerHTML = `<b>Last updated ${esc(upd)} SGT${esc(tt)}</b><br>${bs.dataset.base}`; }
    $("lede").innerHTML = `Malaysian Government Securities (MGS) and Government Investment Issues (GII) from Bank Negara Malaysia: the daily MGS and GII curves from FAST's consolidated indicative yields (the average of the principal dealers' quotes), corporate curves by rating, BNM's benchmark closes and every MGS and GII by stock code and ISIN. Latest curve: <b>${esc(D.curve?.date || "–")}</b>. Data refreshed ${esc(upd)} Singapore / Kuala Lumpur time; the page re-checks every minute.`;
  }
  async function load(first) {
    try {
      const r = await fetch(`${SRC}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (!first && D && j.updated === D.updated) return;
      try { const rc = await fetch(`../data/malaysia-credit.json?t=${Date.now()}`, { cache: "no-store" }); if (rc.ok) CR = await rc.json(); } catch {}
      try { const ri = await fetch(`../data/malaysia-irs.json?t=${Date.now()}`, { cache: "no-store" }); if (ri.ok) IRS = await ri.json(); } catch {}
      D = j; for (const key in bondCache) delete bondCache[key]; render(first);
    } catch (e) { if (first) $("lede").textContent = "Malaysia bond data is not available yet. It is rebuilt after Bank Negara Malaysia's FAST publishes each Kuala Lumpur business day; check back in a few minutes."; }
  }
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => D && (curveChart(), pbPanel()), 120); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => D && (curveChart(), pbPanel(), hist(false)));
  load(true); setInterval(() => load(false), 60000);
})();
