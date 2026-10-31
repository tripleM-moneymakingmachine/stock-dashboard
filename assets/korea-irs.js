/* Korea tab: KRW interest rate swap (IRS) curve, below the KOFIA KTB curve. Fixed-rate leg vs the 91-day CD rate,
   closing rates by tenor from the Seoul money brokers (Korea Money Brokerage 1–10Y, Seoul Money Brokerage mid for
   12–20Y). Draws the latest IRS curve with the curve a week and a month earlier and today's KTB curve for reference,
   and a table of day / week / month / year changes and the swap spread (IRS − KTB at the same tenor).
   Data: data/korea-irs.json (scripts/fetch-korea-irs.mjs) and data/korea.json (KTB curve). */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("irscv")) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const f = (v, n = 2) => v == null || !isFinite(v) ? "–" : (+v).toFixed(n);
  const bp = (v, n = 1) => v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(+v).toFixed(n)}`;
  const cls = (v) => v == null || !isFinite(v) || Math.abs(v) < 0.05 ? "" : v > 0 ? "up" : "down";
  const TEN = [1, 2, 3, 4, 5, 7, 10, 12, 15, 20];
  const st = { max: 20 };
  let I = null, K = null;

  const ser = (t) => I?.tenors?.[t] || [];
  const back = (s, days) => { if (!s.length) return null; const c = new Date(Date.parse(s.at(-1)[0]) - days * 864e5).toISOString().slice(0, 10); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= c) return s[i][1]; return null; };
  const chg = (s, days) => { if (s.length < 2) return null; const p = days === 1 ? s.at(-2)[1] : back(s, days); return p == null ? null : (s.at(-1)[1] - p) * 100; };
  // curve on a date: [tenor, rate] at every quoted tenor (latest close on or before the date)
  const onDate = (d) => TEN.map((t) => { const s = ser(t); for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= d) return [t, s[i][1], s[i][0]]; return null; }).filter(Boolean);
  const daysBack = (d, n) => new Date(Date.parse(d) - n * 864e5).toISOString().slice(0, 10);
  // monotone cubic (Fritsch–Carlson) through the quoted tenors, sampled for drawing
  function smooth(pts, step = 0.1) {
    const n = pts.length; if (n < 3) return pts.map(([t, y]) => [t, y]);
    const x = pts.map((p) => p[0]), y = pts.map((p) => p[1]), h = [], d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i]; d[i] = (y[i + 1] - y[i]) / h[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / d[i - 1] + (h[i] + 2 * h[i - 1]) / d[i]);
    const out = [];
    for (let i = 0; i < n - 1; i++) for (let t = x[i]; t < x[i + 1] - 1e-9; t += step) {
      const s = (t - x[i]) / h[i], s2 = s * s, s3 = s2 * s;
      out.push([+t.toFixed(3), (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h[i] * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h[i] * m[i + 1]]);
    }
    out.push([x[n - 1], y[n - 1]]);
    return out;
  }
  const at = (pts, t) => { if (!pts.length || t < pts[0][0] - 1e-9 || t > pts.at(-1)[0] + 1e-9) return null; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0] + 1e-9) { const [a, ya] = pts[i - 1], [b, yb] = pts[i]; return b === a ? yb : ya + (yb - ya) * (t - a) / (b - a); } return pts.at(-1)[1]; };
  // KTB yield at a tenor on a date: KOFIA's smooth curve when it is for that date, else the benchmark tenors joined linearly
  function ktb(t, d) {
    if (!K) return null;
    if (K.curve?.date === d && K.curve.pts?.length) return at(K.curve.pts, t);
    const pts = Object.keys(K.tenors || {}).map(Number).sort((a, b) => a - b).map((tt) => { const s = K.tenors[tt]; for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= d) return s[i][0] === d ? [tt, s[i][1]] : null; return null; }).filter(Boolean);
    return at(pts, t);
  }

  function table() {
    const d = I.date;
    $("irsTab").innerHTML = TEN.map((t) => {
      const s = ser(t); if (!s.length) return "";
      const td = (v) => `<td class="${cls(v)}">${bp(v)}</td>`;
      const cur = s.at(-1)[0] === d, k = cur ? ktb(t, d) : null, sp = k == null ? null : (s.at(-1)[1] - k) * 100;
      return `<tr${cur ? "" : ' class="mut"'}><td>${t}Y</td><td>${f(s.at(-1)[1], 4)}</td>${td(chg(s, 1))}${td(chg(s, 7))}${td(chg(s, 30))}${td(chg(s, 365))}<td>${bp(sp)}</td></tr>`;
    }).join("");
  }

  function chart() {
    const svg = $("irscv"), W = Math.max(300, svg.clientWidth || 600), Hh = 320, P = { l: 44, r: 12, t: 12, b: 28 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const max = st.max, d = I.date, cut = (pts) => pts.filter(([t]) => t <= max + 1e-9);
    const q = onDate(d).filter((p) => p[2] === d), now = cut(smooth(q)), qd = cut(q);
    const w1 = cut(smooth(onDate(daysBack(d, 7)))), m1 = cut(smooth(onDate(daysBack(d, 30))));
    const old = (pts, dd) => (onDate(dd).length && onDate(dd).every((p) => p[2] < d)) ? pts : []; // only when history reaches back
    const W1 = old(w1, daysBack(d, 7)), M1 = old(m1, daysBack(d, 30));
    const kt = K?.curve?.pts ? cut(K.curve.pts.filter(([t]) => t >= 1 - 1e-9)) : [];
    const ys = [...now, ...W1, ...M1, ...kt].map((p) => p[1]);
    if (!ys.length) { svg.innerHTML = ""; return; }
    let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad;
    const X = (t) => P.l + t / max * (W - P.l - P.r), Y = (y) => P.t + (hi - y) / (hi - lo) * (Hh - P.t - P.b);
    const line = (pts, col, w, dash = "") => pts.length > 1 ? `<polyline points="${pts.map(([t, y]) => `${X(t).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>` : "";
    let g = "";
    const step = (hi - lo) > 1.2 ? 0.25 : (hi - lo) > 0.5 ? 0.1 : 0.05;
    for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--line)" stroke-width="1"/><text x="${P.l - 6}" y="${Y(y) + 3.5}" text-anchor="end">${y.toFixed(2)}</text>`;
    const nar = W < 520, xt = max <= 10 ? (nar ? [0, 2, 5, 7, 10] : [0, 1, 2, 3, 4, 5, 7, 10]) : (nar ? [0, 5, 10, 15, 20] : [0, 1, 2, 3, 5, 7, 10, 12, 15, 20]);
    for (const t of xt) g += `<text x="${X(t)}" y="${Hh - 8}" text-anchor="middle">${t ? t + "Y" : "0"}</text>`;
    g += line(kt, "var(--c6)", 1.4, "1 3") + line(M1, "var(--c3)", 1.4, "4 3") + line(W1, "var(--c2)", 1.4, "4 3") + line(now, "var(--c1)", 2.4);
    g += qd.map(([t, y]) => `<circle cx="${X(t).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="3.2" fill="var(--c1)" stroke="var(--panel)" stroke-width="1.2"/>`).join("");
    g += `<line id="irsX" y1="${P.t}" y2="${Hh - P.b}" stroke="var(--muted)" stroke-dasharray="2 3" visibility="hidden"/><circle id="irsP" r="4" fill="var(--c1)" visibility="hidden"/>`;
    svg.innerHTML = g;
    const tip = $("irsTip"), vx = svg.querySelector("#irsX"), vp = svg.querySelector("#irsP");
    const leave = () => { tip.hidden = true; vx.setAttribute("visibility", "hidden"); vp.setAttribute("visibility", "hidden"); };
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W / r.width;
      if (sx < P.l || sx > W - P.r) { leave(); return; }
      let t = (sx - P.l) / (W - P.l - P.r) * max;
      const near = qd.find(([tt]) => Math.abs(X(tt) - sx) < 8); if (near) t = near[0];
      const y = at(now, t); if (y == null) { leave(); return; }
      const k = ktb(t, d), wy = at(W1, t), my = at(M1, t), px = X(t), py = Y(y);
      tip.innerHTML = `${near ? `<b>${t}Y</b>` : `${t.toFixed(1)}Y`} · IRS <b>${y.toFixed(4)}%</b>` +
        (k != null ? `<br>KTB ${k.toFixed(3)}% · swap spread <b>${bp((y - k) * 100)} bp</b>` : "") +
        (wy != null ? `<br>1W <span class="${cls((y - wy) * 100)}">${bp((y - wy) * 100)} bp</span>` : "") + (my != null ? ` · 1M <span class="${cls((y - my) * 100)}">${bp((y - my) * 100)} bp</span>` : "");
      vx.setAttribute("x1", px); vx.setAttribute("x2", px); vx.setAttribute("visibility", "visible");
      vp.setAttribute("cx", px); vp.setAttribute("cy", py); vp.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(0, px * r.width / W + 12), r.width - tip.offsetWidth) + "px";
      tip.style.top = Math.max(0, py * r.height / Hh - tip.offsetHeight - 10) + "px";
    };
    svg.onpointermove = move; svg.onpointerdown = move; svg.onpointerleave = leave;
    $("irsW1").style.display = W1.length ? "" : "none"; $("irsM1").style.display = M1.length ? "" : "none";
  }

  function render() {
    $("irsRng").innerHTML = [[10, "0–10Y"], [20, "0–20Y"]].map(([m, l]) => `<button type="button" data-m="${m}" aria-pressed="${m === st.max}">${l}</button>`).join("");
    $("irsRng").querySelectorAll("button").forEach((b) => b.onclick = () => { st.max = +b.dataset.m; render(); });
    $("irsNow").textContent = `KRW IRS ${I.date}`;
    $("irsKtb").textContent = K?.curve?.date ? `KTB curve ${K.curve.date}` : "KTB curve";
    table(); chart();
    const first = TEN.map((t) => ser(t)[0]?.[0]).filter(Boolean).sort()[0];
    const stale = TEN.filter((t) => ser(t).length && ser(t).at(-1)[0] !== I.date).map((t) => `${t}Y`);
    $("irsNote").textContent = `KRW interest rate swaps, fixed rate against the 91-day CD rate (quarterly), closing rates for ${I.date}: 1–10Y from Korea Money Brokerage's daily closes, 12–20Y from Seoul Money Brokerage's mid quote (where both quote a tenor, their closes agree within about 1–2 bp). The line is joined smoothly between the quoted tenors (dots). Dashed lines are the closes a week and a month earlier; the dotted grey line is the KOFIA KTB curve. Swap spread = IRS minus the KTB yield at the same tenor on the same day (negative means swaps yield less than KTBs). History starts ${first || "–"}, so the 1M and 1Y columns fill in as it builds.${stale.length ? ` Greyed rows (${stale.join(", ")}) are older closes.` : ""}`;
  }

  const get = (u) => fetch(u + "?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  async function load(first) {
    const [i, k] = await Promise.all([get("../data/korea-irs.json"), first || !K ? get("../data/korea.json") : Promise.resolve(K)]);
    if (!i?.tenors) { if (first) { $("irsNote").textContent = "The KRW IRS curve is not in the data yet. It is added after the Seoul brokers post their closes each business day (around 17:45 Singapore time)."; } return; }
    if (!first && I && i.updated === I.updated) return;
    I = i; if (k) K = k; $("irs").hidden = false; render();
  }
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => I && chart(), 120); });
  load(true); setInterval(() => load(false), 300000);
})();
