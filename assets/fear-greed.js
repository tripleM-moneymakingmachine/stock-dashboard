/* Nasdaq fear & greed factor on the main page, just above the previous-session recap.
   Everything shown comes from data/fear-greed.json, built by scripts/fetch-fear-greed.mjs
   (.github/workflows/fear-greed.yml, after each US close). 0 = maximum fear, 100 = maximum greed.
   putcall (Cboe put/call ratios) is optional and hand-maintained; the panel hides it when absent. */
(function () {
  const box = document.getElementById("feargreed");
  if (!box) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const dt = (s, o) => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, o));
  const day = (s) => dt(s, { month: "short", day: "numeric", year: "numeric" });
  const sg = (v, dp) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dp == null ? 1 : dp);
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const tone = (s) => (s <= 45 ? "down" : s >= 55 ? "up" : "mixed");
  fetch((box.dataset.src || "data/fear-greed.json") + "?t=" + Date.now(), { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.latest || !d.d || !d.d.length) return;
      const L = d.latest, t = tone(L.fg);
      const haven = L.g20 > 0 && L.n20 < 0
        ? `Gold is up ${Math.abs(L.g20).toFixed(1)}% over the last 20 sessions while the Nasdaq is down ${Math.abs(L.n20).toFixed(1)}%: money is moving into the safe haven.`
        : L.g20 < 0 && L.n20 < 0
          ? `Gold is down ${Math.abs(L.g20).toFixed(1)}% over the last 20 sessions alongside the Nasdaq's ${Math.abs(L.n20).toFixed(1)}% fall, so there is no safe-haven bid in gold.`
          : `Over the last 20 sessions the Nasdaq is ${sg(L.n20)}% and gold ${sg(L.g20)}%.`;
      const comp = (d.comp || []).map(([n, s, txt]) =>
        `<div class="rc-s" title="${esc(txt)}"><span class="rc-n">${esc(n)}</span><span class="rc-v">${esc(s)}</span><span class="rc-c ${tone(s) === "mixed" ? "" : tone(s)}">${esc(txt)}</span></div>`).join("");
      const eps = (d.episodes || []).map((e) =>
        `<tr><td>${esc(day(e.peak))}</td><td>${esc(day(e.trough))}${e.open ? " *" : ""}</td><td>${esc(e.days)}</td><td class="${cls(e.ndq)}">${sg(e.ndq)}%</td><td class="${cls(e.gold)}">${sg(e.gold)}%</td><td>${esc(e.vixmax.toFixed(2))}</td><td>${esc(e.fgpeak)}</td><td>${esc(e.fgmin)}</td></tr>`).join("");
      const zones = (d.zones || []).map(([z, rg, n, f, hit]) =>
        `<tr><td>${esc(z)}</td><td>${esc(rg.replace("-", "–"))}</td><td>${esc(n)}</td><td class="${f == null ? "" : cls(f)}">${f == null ? "–" : sg(f) + "%"}</td><td>${hit == null ? "–" : esc(hit) + "%"}</td></tr>`).join("");
      const pc = d.putcall && d.putcall.rows && d.putcall.rows.length
        ? `<h3>Cboe put/call volume ratios${d.putcall.asof ? " · " + esc(d.putcall.asof) : ""}</h3>` +
          `<div class="fg-tw"><table class="fg-t"><thead><tr><th>Ratio</th><th>Value</th></tr></thead><tbody>${d.putcall.rows.map(([n, v]) => `<tr><td>${esc(n)}</td><td>${esc((+v).toFixed(2))}</td></tr>`).join("")}</tbody></table></div>` +
          `<p class="rc-note">Above 1 means more puts than calls traded. A snapshot only: daily put/call history has no free source, so it is not part of the factor and the two VIX scores stand in for option demand.${d.putcall.url ? ` <a href="${esc(d.putcall.url)}" target="_blank" rel="noopener">Cboe daily statistics</a>.` : ""}</p>`
        : `<p class="rc-note">Daily put/call history has no free source, so it is not part of the factor; the two VIX scores stand in for option demand.</p>`;
      box.className = "recap fgp t-" + t;
      box.innerHTML =
        `<div class="eyebrow">Nasdaq fear &amp; greed · close of ${esc(dt(d.session, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}</div>` +
        `<div class="fg-top"><div class="fg-sc"><span class="fg-num">${esc(L.fg)}</span><span class="fg-of">/ 100</span></div>` +
        `<div class="fg-zw"><h2>${esc(L.zone)}</h2>${L.wk == null ? "" : `<span class="rc-c ${cls(L.wk)}">${sg(L.wk, 0)} points vs 5 sessions earlier</span>`}</div></div>` +
        `<div class="fg-gauge" role="img" aria-label="Factor ${esc(L.fg)} on a scale from 0, maximum fear, to 100, maximum greed"><i style="left:${Math.max(0, Math.min(100, L.fg))}%"></i></div>` +
        `<div class="fg-gl"><span>Extreme fear</span><span>Neutral</span><span>Extreme greed</span></div>` +
        `<p class="rc-sum">The Nasdaq Composite closed at ${esc(L.ndq.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}, ${Math.abs(L.dd).toFixed(1)}% below its 252-session high, with the VIX at ${esc(L.vix.toFixed(2))} against ${esc(L.rv.toFixed(1))}% realised volatility. ${esc(haven)}</p>` +
        `<div class="rc-stats fg-comp">${comp}</div>` +
        `<div class="fg-ch" id="fgChart"></div>` +
        `<p class="rc-note">Factor since ${esc(dt(d.d[0], { month: "short", year: "numeric" }))}. Red band: extreme fear (25 or lower). Green band: extreme greed (above 75). Grey spans: Nasdaq declines of 8% or more, peak to trough.</p>` +
        `<details class="fg-more"><summary>Selloffs vs the safe-haven bid, what followed each zone, put/call and method</summary>` +
        `<h3>Nasdaq selloffs of 8% or more, and what gold did</h3>` +
        `<div class="fg-tw"><table class="fg-t"><thead><tr><th>Peak</th><th>Trough</th><th>Sessions</th><th>Nasdaq</th><th>Gold</th><th>Highest VIX</th><th>Factor at peak</th><th>Lowest factor</th></tr></thead><tbody>${eps}</tbody></table></div>` +
        ((d.episodes || []).some((e) => e.open) ? `<p class="rc-note">* Measured to the latest close; this selloff may not be over.</p>` : "") +
        `<h3>Nasdaq over the next 20 sessions, by zone on the starting day</h3>` +
        `<div class="fg-tw"><table class="fg-t"><thead><tr><th>Zone</th><th>Factor</th><th>Days</th><th>Average return</th><th>Followed by a gain</th></tr></thead><tbody>${zones}</tbody></table></div>` +
        `<p class="rc-note">About two years of data, overlapping windows and scores ranked with hindsight: a description of the sample, not a forecast.</p>` +
        pc +
        `<h3>Method</h3><p class="rc-note">Equal-weighted average of six scores, each the percentile of the latest reading within the ${esc(d.window.n)} sessions from ${esc(day(d.window.from))}: Nasdaq vs its 50-day average, drawdown from the 252-session high, 20-session realised volatility, VIX level, VIX vs its 50-day average, and the Nasdaq's 20-session return minus gold's. The safe-haven score reads as greed when the Nasdaq beats gold, so it stays mid-range when both fall together. Treasuries and the yen are not included.</p>` +
        `</details>` +
        `<p class="rc-src">Computed from ${esc(d.src || "daily closes")} after each US close. Not advice.</p>`;
      box.hidden = false;
      const host = document.getElementById("fgChart");
      const draw = () => chart(host, d);
      draw();
      let w = host.clientWidth;
      addEventListener("resize", () => { if (host.clientWidth !== w) { w = host.clientWidth; draw(); } });
    })
    .catch(() => {});

  function chart(host, d) {
    const W = Math.max(280, host.clientWidth || 600), H = 190, ml = 30, mr = 8, mt = 8, mb = 22, n = d.d.length;
    const x = (i) => ml + (W - ml - mr) * (n > 1 ? i / (n - 1) : 0), y = (v) => mt + (H - mt - mb) * (1 - v / 100);
    const idx = Object.fromEntries(d.d.map((s, i) => [s, i]));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Nasdaq fear and greed factor over time, with selloffs shaded">`;
    s += `<rect x="${ml}" y="${y(100)}" width="${W - ml - mr}" height="${y(75) - y(100)}" fill="var(--up)" opacity=".1"/>`;
    s += `<rect x="${ml}" y="${y(25)}" width="${W - ml - mr}" height="${y(0) - y(25)}" fill="var(--down)" opacity=".1"/>`;
    for (const e of d.episodes || []) {
      const a = idx[e.peak], b = idx[e.trough];
      if (a == null || b == null) continue;
      s += `<rect x="${x(a).toFixed(1)}" y="${mt}" width="${Math.max(1, x(b) - x(a)).toFixed(1)}" height="${H - mt - mb}" fill="var(--muted)" opacity=".16"/>`;
    }
    for (const v of [0, 25, 50, 75, 100]) {
      s += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end" class="fg-ax">${v}</text>`;
    }
    const step = W < 520 ? 6 : 3;
    let lastX = -99;
    d.d.forEach((ds, i) => {
      if (!i || ds.slice(0, 7) === d.d[i - 1].slice(0, 7)) return;
      const m = +ds.slice(5, 7);
      if ((m - 1) % step || x(i) - lastX < 60 || x(i) > W - mr - 24) return;
      lastX = x(i);
      s += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="fg-ax">${dt(ds, { month: "short", year: "2-digit" })}</text>`;
    });
    s += `<path d="${d.fg.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("")}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/>`;
    s += `<line id="fgRule" y1="${mt}" y2="${H - mb}" stroke="var(--muted)" visibility="hidden"/><circle id="fgDot" r="3.5" fill="var(--accent)" visibility="hidden"/>`;
    s += `<rect id="fgHit" x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="transparent"/></svg><div class="fg-tip" hidden></div>`;
    host.innerHTML = s;
    const tip = host.querySelector(".fg-tip"), rule = host.querySelector("#fgRule"), dot = host.querySelector("#fgDot"), svg = host.querySelector("svg");
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(n - 1, Math.round((px - ml) / (W - ml - mr) * (n - 1))));
      rule.setAttribute("x1", x(i)); rule.setAttribute("x2", x(i)); rule.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(d.fg[i])); dot.setAttribute("visibility", "visible");
      tip.innerHTML = `<b>${esc(dt(d.d[i], { month: "short", day: "numeric", year: "numeric" }))}</b><br>Factor ${esc(d.fg[i].toFixed(0))}<br>Nasdaq ${esc(Math.round(d.ndq[i]).toLocaleString("en-US"))}<br>VIX ${esc(d.vix[i].toFixed(2))}<br>20 sessions: Nasdaq ${sg(d.n20[i])}%, gold ${sg(d.g20[i])}%`;
      tip.hidden = false;
      const tw = tip.offsetWidth, cx = x(i) * (r.width / W);
      tip.style.left = Math.max(0, Math.min(r.width - tw, cx + 12 + tw > r.width ? cx - tw - 12 : cx + 12)) + "px";
    };
    const hit = host.querySelector("#fgHit");
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { tip.hidden = true; rule.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
  }
})();
