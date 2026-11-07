/* Second-order impact map on the Datacenter page (#usdc2).
   Follows the US data center delays from the map above (#usdc) down the supply chain:
   hostile states → components (GPUs, CPUs, HBM/DRAM, SSD, switching, optics & lasers, fiber, foundry,
   chip equipment, power & cooling, grid power) → the companies that sell them.
   - Interactive flow map: band width = revenue at risk in the next 12 months after the supply chain
     re-sells what it can (absorption). Green bands = the on-site power workaround (winners).
   - Sliders: GW delayed over the next 12 months, share recaptured in friendly states or overseas,
     GW switched to on-site power. Hover a band or node to trace it; click a company for the view.
   - Table: gross deferred, absorbed, net $B and % of annual revenue (latest quarter ×4), with views.
   Data: data/dc-supply-impact.json (content per GW, shares, absorption, views) and
   data/us-datacenters.json (which states the at-risk capacity sits in). No external libraries. */
(function () {
  const host = document.getElementById("usdc2");
  if (!host) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (v, d = 1) => (v == null || isNaN(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const NS = "http://www.w3.org/2000/svg";
  const SNAME = { TX: "Texas", GA: "Georgia", OH: "Ohio", MI: "Michigan", PA: "Pennsylvania", IL: "Illinois", KS: "Kansas", ME: "Maine", NH: "New Hampshire", CA: "California" };
  const CC = { gpu: "#2b7bd8", cpu: "#5c7c99", mem: "#7a4fd6", nand: "#9c6bd6", net: "#0aa5b5", opt: "#d6456f", fib: "#c27a1a", fab: "#4b5563", eqp: "#8795a6", pwr: "#b8901a", grid: "#a04020", onsite: "var(--up)" };

  const css = `
#usdc2 .sk{overflow-x:auto}
#usdc2 svg.sank{width:100%;min-width:820px;height:auto;display:block}
#usdc2 .lk{fill-opacity:.38;transition:fill-opacity .15s;cursor:pointer}
#usdc2 .lk.pos{fill-opacity:.5}
#usdc2 svg.hl .lk{fill-opacity:.06}
#usdc2 svg.hl .lk.on{fill-opacity:.7}
#usdc2 .nd rect{rx:2;cursor:pointer}
#usdc2 svg.hl .nd:not(.on) rect{opacity:.3}
#usdc2 .nd text{font:600 12px var(--f-body);fill:var(--ink);cursor:pointer}
#usdc2 .nd text.v{font:500 11px var(--f-mono);fill:var(--muted)}
#usdc2 .colh{font:600 10px var(--f-mono);letter-spacing:.1em;text-transform:uppercase;fill:var(--muted)}
#usdc2 .sliders{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:12px 18px;margin:0 0 14px}
#usdc2 .sliders label{display:block;font:600 10px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
#usdc2 .sliders output{float:right;font:600 12px var(--f-mono);color:var(--ink);letter-spacing:0;text-transform:none}
#usdc2 .sliders input[type=range]{width:100%;margin:4px 0;accent-color:var(--accent)}
#usdc2 .sliders small{display:block;font-size:11px;color:var(--muted);line-height:1.3}
#usdc2 .mode{margin:0 0 12px}
#usdc2 .tw{overflow-x:auto}
#usdc2 table.it{width:100%;border-collapse:collapse;font-size:13px;min-width:700px}
#usdc2 .it th{font:600 10px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:right;padding:6px;border-bottom:1px solid var(--line);cursor:pointer;white-space:nowrap}
#usdc2 .it th:first-child,#usdc2 .it td:first-child,#usdc2 .it th:nth-child(2),#usdc2 .it td:nth-child(2){text-align:left}
#usdc2 .it td{text-align:right;padding:7px 6px;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent);font:500 13px var(--f-mono);font-variant-numeric:tabular-nums;vertical-align:top}
#usdc2 .it td:first-child{font:600 13.5px var(--f-body);white-space:nowrap}
#usdc2 .it td:nth-child(2){font:400 12px var(--f-body);color:var(--muted);min-width:150px}
#usdc2 .it tr{cursor:pointer}
#usdc2 .it tr.on td{background:color-mix(in srgb,var(--accent-soft) 70%,transparent)}
#usdc2 .it tr.open td{border-bottom:0}
#usdc2 .it tr.vw td{font:400 13.5px var(--f-body);color:var(--ink);text-align:left;white-space:normal;padding:2px 6px 12px;background:color-mix(in srgb,var(--accent-soft) 40%,transparent)}
#usdc2 .dir{font:600 11px var(--f-mono);padding:2px 6px;border-radius:3px;white-space:nowrap}
#usdc2 .d-neg{background:color-mix(in srgb,var(--down) 16%,transparent);color:var(--down)}
#usdc2 .d-pos{background:color-mix(in srgb,var(--up) 18%,transparent);color:var(--up)}
#usdc2 .d-mix{background:color-mix(in srgb,#d08a1c 20%,transparent);color:#b0700e}
#usdc2 .cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:10px;margin-top:12px}
#usdc2 .cats div{border:1px solid var(--line);border-radius:5px;padding:10px 12px;font-size:13px;background:var(--panel)}
#usdc2 .cats b{display:flex;align-items:center;gap:6px;font:600 13.5px var(--f-body);margin-bottom:3px}
#usdc2 .cats b i{width:10px;height:10px;border-radius:2px;display:inline-block}
#usdc2 .cats span{font:500 11.5px var(--f-mono);color:var(--muted)}
#usdc2 .cats p{margin:4px 0 0;color:var(--muted);font-size:12.5px;line-height:1.4}
#usdc2 .swipe{display:none}
@media (max-width:760px){#usdc2 .swipe{display:block}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  host.innerHTML = `
    <h2 id="us2H">Second-order impact: from delayed campuses to chips, memory, lasers and power</h2>
    <p class="sub">What the US delays on the map above mean for the companies that supply each campus. Bands show revenue at risk over the next 12 months after the supply chain re-sells what it can; green bands are the companies that gain from the workarounds. Hover to trace a flow, tap a company for the view.</p>
    <div class="kpi tiles" id="u2K" style="margin-bottom:14px"></div>
    <div class="panel">
      <div class="sliders" id="u2Sl"></div>
      <div class="ctl mode"><div class="cg"><span class="cgl">Show</span><div class="seg" id="u2Mode"><button data-v="net" aria-pressed="true">Net of absorption</button><button data-v="gross" aria-pressed="false">Gross deferred</button></div></div></div>
      <p class="note swipe">Swipe sideways to see the whole flow.</p>
      <div class="sk" id="u2Sk"></div>
      <p class="note" id="u2Note"></p>
    </div>
    <h3 style="font:700 19px var(--f-display);margin:22px 0 4px">Company by company</h3>
    <p class="sub">Net = gross deferred × (1 − absorption). % of revenue uses the latest quarter ×4 (~ = Claude estimate for names without a dashboard page). Tap a row for the view.</p>
    <div class="panel tw" id="u2Tab"></div>
    <h3 style="font:700 19px var(--f-display);margin:22px 0 4px">Why each component is hit differently</h3>
    <div class="cats" id="u2Cats"></div>`;

  let D = null, U = null, P = {}, mode = "net", sel = null, sortK = "net";

  function stateShares() {
    const tier = (c) => ((U.risk[c] || {}).tier || 3);
    const g = {};
    const rem = (s) => Math.max(0, s.gw - (s.now != null ? s.now : s.status === "op" ? s.gw : 0));
    U.sites.filter((s) => rem(s) > 0 && tier(s.state) >= 4).forEach((s) => { g[s.state] = (g[s.state] || 0) + rem(s); });
    const tot = Object.values(g).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(g).map(([c, v]) => ({ c, share: v / tot, gw: v })).sort((a, b) => b.gw - a.gw);
  }
  function model() {
    const sh = stateShares();
    const lostGW = P.delayGW * (1 - P.recapture / 100);
    const states = sh.map((x) => ({ ...x, lost: lostGW * x.share }));
    const txLost = (states.find((s) => s.c === "TX") || { lost: 0 }).lost;
    const cats = D.cats.map((c) => {
      const gw = c.id === "grid" ? txLost : lostGW; // grid power: only Texas load counts for ERCOT generators
      return { ...c, gw, gross: gw * c.perGW };
    });
    const cmap = Object.fromEntries(cats.map((c) => [c.id, c]));
    const cos = D.cos.map((co) => {
      const parts = Object.entries(co.s || {}).map(([k, s]) => { const c = cmap[k]; const g = c.gross * s; return { k, gross: g, net: g * (1 - c.absorb) }; });
      const gross = parts.reduce((a, p) => a + p.gross, 0), net = parts.reduce((a, p) => a + p.net, 0);
      const gain = co.onsite ? P.selfPower * D.onsitePerGW * co.onsite : 0;
      const dir = gain > net ? "pos" : co.scarcity ? "mix" : gain > 0 ? "mix" : net / co.rev > 0.004 ? "neg" : "flat";
      return { ...co, parts, gross, net, gain, total: net - gain, pct: co.rev ? ((net - gain) / co.rev) * 100 : null, dir };
    });
    return { states, cats, cos, lostGW };
  }

  function sankey(M) {
    const box = document.getElementById("u2Sk");
    const W = 1060, padT = 30, gap = 8;
    const X = [150, 480, 820], NW = 12;
    const key = mode === "net" ? "net" : "gross";
    // links: state -> cat, cat -> company (negative impact), onsite -> company (gain)
    const L1 = [], L2 = [];
    M.states.forEach((s) => M.cats.forEach((c) => {
      const base = c.id === "grid" ? (s.c === "TX" ? c.gross : 0) : s.lost * c.perGW;
      const v = mode === "net" ? base * (1 - c.absorb) : base;
      if (v > 0.005) L1.push({ a: "s:" + s.c, b: "c:" + c.id, v, col: CC[c.id] });
    }));
    M.cos.forEach((co) => co.parts.forEach((p) => { const v = p[key]; if (v > 0.005) L2.push({ a: "c:" + p.k, b: "o:" + co.t, v, col: CC[p.k] }); }));
    M.cos.filter((co) => co.gain > 0).forEach((co) => L2.push({ a: "c:onsite", b: "o:" + co.t, v: co.gain, col: CC.onsite, pos: true }));
    const L = L1.concat(L2);
    const sumIn = (id) => L.filter((l) => l.b === id).reduce((a, l) => a + l.v, 0);
    const sumOut = (id) => L.filter((l) => l.a === id).reduce((a, l) => a + l.v, 0);
    const col0 = M.states.map((s) => ({ id: "s:" + s.c, n: SNAME[s.c] || s.c, sub: fmt(s.lost) + " GW lost" }));
    const col1 = M.cats.map((c) => ({ id: "c:" + c.id, n: c.n, col: CC[c.id] })).concat(P.selfPower > 0 ? [{ id: "c:onsite", n: "On-site power workaround", col: CC.onsite, pos: true }] : []);
    const col2 = M.cos.filter((co) => sumIn("o:" + co.t) > 0.005).sort((a, b) => sumIn("o:" + b.t) - sumIn("o:" + a.t)).map((co) => ({ id: "o:" + co.t, n: co.t, co }));
    const cols = [col0, col1, col2];
    cols.forEach((cl, i) => cl.forEach((n) => { n.v = i === 0 ? sumOut(n.id) : i === 1 ? Math.max(sumIn(n.id), sumOut(n.id)) : sumIn(n.id); }));
    cols[1] = cols[1].filter((n) => n.v > 0.005);
    const H = 620;
    const scale = Math.min(...cols.map((cl) => (H - padT - gap * (cl.length - 1)) / (cl.reduce((a, n) => a + n.v, 0) || 1)));
    const minH = 3;
    let maxY = 0;
    const MINS = [minH, 15, 15];
    cols.forEach((cl, i) => { let y = padT; cl.forEach((n) => { n.x = X[i]; n.y = y; const bh = Math.max(minH, n.v * scale); n.h = bh; n.slot = Math.max(MINS[i], bh); n.oy = y + (n.slot - bh) / 2; n.iy = n.oy; n.y = n.oy; y += n.slot + (i ? 3 : gap); }); maxY = Math.max(maxY, y); });
    const byId = Object.fromEntries(cols.flat().map((n) => [n.id, n]));
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "sank"); svg.setAttribute("viewBox", `0 0 ${W} ${Math.ceil(maxY + 6)}`);
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Flow of revenue at risk from hostile states to components to companies");
    const head = (x, t, anchor) => { const e = document.createElementNS(NS, "text"); e.setAttribute("class", "colh"); e.setAttribute("x", x); e.setAttribute("y", 14); if (anchor) e.setAttribute("text-anchor", anchor); e.textContent = t; svg.appendChild(e); };
    head(X[0] + NW, "Hostile states", "end"); head(X[1], "Components"); head(X[2] + NW, "Companies ($B, 12 mo)");
    const gL = document.createElementNS(NS, "g"); svg.appendChild(gL);
    // order links for neat stacking
    const order = (id) => { const n = byId[id]; return n ? n.y : 0; };
    L.sort((p, q) => order(p.a) - order(q.a) || order(p.b) - order(q.b));
    L.forEach((l) => {
      const a = byId[l.a], b = byId[l.b]; if (!a || !b) return;
      const h = Math.max(0.8, l.v * scale);
      const x0 = a.x + NW, x1 = b.x, y0 = a.oy, y1 = b.iy; a.oy += h; b.iy += h;
      const mx = (x0 + x1) / 2;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z`);
      p.setAttribute("fill", l.col); p.setAttribute("class", "lk" + (l.pos ? " pos" : ""));
      p.dataset.a = l.a; p.dataset.b = l.b;
      const t = document.createElementNS(NS, "title");
      t.textContent = `${a.n} → ${b.n}: ${l.pos ? "+" : ""}$${fmt(l.v, 2)}B`;
      p.appendChild(t);
      p.addEventListener("mouseenter", () => hl([l.a, l.b], [p]));
      p.addEventListener("mouseleave", () => hl(null));
      gL.appendChild(p);
    });
    cols.forEach((cl, i) => cl.forEach((n) => {
      const g = document.createElementNS(NS, "g"); g.setAttribute("class", "nd"); g.dataset.id = n.id;
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", n.x); r.setAttribute("y", n.y); r.setAttribute("width", NW); r.setAttribute("height", n.h);
      r.setAttribute("fill", i === 0 ? "var(--down)" : i === 1 ? n.col : n.co.dir === "pos" ? "var(--up)" : "var(--ink)");
      g.appendChild(r);
      const tx = document.createElementNS(NS, "text");
      const right = i === 2;
      tx.setAttribute("x", i === 0 ? n.x - 6 : n.x + NW + 6); if (i === 0) tx.setAttribute("text-anchor", "end"); tx.setAttribute("y", n.y + n.h / 2 + (i === 0 ? -3 : 4));
      const val = i === 0 ? "" : i === 2 ? (n.co.gain > 0 ? "+$" + fmt(n.co.gain) + "B" + (n.co.net > 0.005 ? " / −$" + fmt(n.co[key]) + "B" : "") : "−$" + fmt(n.v) + "B") : "$" + fmt(n.v) + "B";
      tx.textContent = (right ? n.co.n : n.n) + "  ";
      if (i === 0) { const t2 = document.createElementNS(NS, "tspan"); t2.setAttribute("x", n.x - 6); t2.setAttribute("dy", 14); t2.setAttribute("style", "font:500 10.5px var(--f-mono);fill:var(--muted)"); t2.textContent = n.sub; tx.appendChild(t2); }
      const tv = document.createElementNS(NS, "tspan"); tv.setAttribute("class", "v"); tv.setAttribute("style", "font:500 11px var(--f-mono);fill:var(--muted)"); tv.textContent = val;
      tx.appendChild(tv);
      if (i === 1 && n.v * scale < 14) tx.setAttribute("y", n.y + n.h / 2 + 4);
      g.appendChild(tx);
      g.addEventListener("mouseenter", () => hl([n.id]));
      g.addEventListener("mouseleave", () => hl(sel ? ["o:" + sel] : null));
      g.addEventListener("click", () => { if (i === 2) { pick(n.co.t, true); } });
      svg.appendChild(g);
    }));
    box.innerHTML = ""; box.appendChild(svg);
    function hl(ids, paths) {
      if (!ids) { svg.classList.remove("hl"); svg.querySelectorAll(".on").forEach((e) => e.classList.remove("on")); if (sel) hl(["o:" + sel]); return; }
      svg.classList.add("hl"); svg.querySelectorAll(".on").forEach((e) => e.classList.remove("on"));
      const on = new Set(ids);
      // trace upstream and downstream one hop each way from each id
      const links = [...svg.querySelectorAll(".lk")];
      const touch = (id) => links.filter((p) => p.dataset.a === id || p.dataset.b === id);
      const lit = new Set(paths || []);
      ids.forEach((id) => touch(id).forEach((p) => { lit.add(p); on.add(p.dataset.a); on.add(p.dataset.b); }));
      // for a company, also light the state links feeding its components
      ids.filter((id) => id.startsWith("o:")).forEach((id) => touch(id).forEach((p) => touch(p.dataset.a).filter((q) => q.dataset.a.startsWith("s:")).forEach((q) => { lit.add(q); on.add(q.dataset.a); })));
      lit.forEach((p) => p.classList.add("on"));
      svg.querySelectorAll(".nd").forEach((g) => g.classList.toggle("on", on.has(g.dataset.id)));
    }
    if (sel) hl(["o:" + sel]);
  }

  function table(M) {
    const rows = [...M.cos].sort((a, b) => (sortK === "pct" ? (b.pct || 0) - (a.pct || 0) : b[sortK] - a[sortK]));
    const DIR = { neg: ["d-neg", "Negative"], pos: ["d-pos", "Net winner"], mix: ["d-mix", "Mixed"], flat: ["d-mix", "Minimal"] };
    const catN = Object.fromEntries(D.cats.map((c) => [c.id, c.n]));
    document.getElementById("u2Tab").innerHTML = `<table class="it"><thead><tr><th>Company</th><th>Exposed through</th><th data-k="gross">Gross $B</th><th data-k="net">Net $B</th><th data-k="gain">Gain $B</th><th data-k="pct">% of rev.</th><th>Read</th></tr></thead><tbody>${rows.map((r) => {
      const [dc, dn] = DIR[r.dir];
      const via = r.parts.map((p) => catN[p.k]).concat(r.onsite ? ["On-site power"] : []).concat(r.scarcity ? ["Scarcity value of existing power"] : []).join(", ");
      const open = sel === r.t;
      return `<tr data-t="${r.t}" class="${open ? "on open" : ""}"><td>${r.page ? `<a href="../${r.page}/" onclick="event.stopPropagation()">${esc(r.t)}</a>` : esc(r.t)} <span style="font-weight:400;color:var(--muted)">${esc(r.n)}</span></td><td>${esc(via)}</td>
        <td>${fmt(r.gross)}</td><td>${fmt(r.net)}</td><td>${r.gain ? "+" + fmt(r.gain) : "—"}</td>
        <td class="${r.pct > 2 ? "down" : r.pct < 0 ? "up" : ""}">${r.pct == null ? "—" : (r.pct < 0 ? "+" : r.pct > 0 ? "−" : "") + fmt(Math.abs(r.pct)) + "%" + (r.est ? " (est.)" : "")}</td>
        <td><span class="dir ${dc}">${dn}</span></td></tr>${open ? `<tr class="vw"><td colspan="7">${esc(D.views[r.t] || "")}</td></tr>` : ""}`;
    }).join("")}</tbody></table>`;
    document.querySelectorAll("#u2Tab th[data-k]").forEach((th) => (th.onclick = () => { sortK = th.dataset.k; render(); }));
    document.querySelectorAll("#u2Tab tr[data-t]").forEach((tr) => (tr.onclick = () => pick(tr.dataset.t)));
  }
  function pick(t, scroll) {
    sel = sel === t ? null : t; render();
    if (scroll && sel) { const tr = document.querySelector(`#u2Tab tr[data-t="${t}"]`); if (tr) tr.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  function kpis(M) {
    const net = M.cos.reduce((a, c) => a + c.net, 0), gross = M.cos.reduce((a, c) => a + c.gross, 0), gain = M.cos.reduce((a, c) => a + c.gain, 0);
    const worst = [...M.cos].filter((c) => c.pct != null).sort((a, b) => b.pct - a.pct)[0];
    const best = [...M.cos].sort((a, b) => a.total - b.total)[0];
    document.getElementById("u2K").innerHTML = [
      ["US capacity lost in-year", fmt(M.lostGW) + " GW", `${fmt(P.delayGW)} GW delayed, ${P.recapture}% recaptured elsewhere`],
      ["Supplier revenue deferred", "$" + fmt(gross, 0) + "B", "Gross, before the supply chain re-sells it"],
      ["Net revenue at risk", "$" + fmt(net, 0) + "B", `${fmt((net / gross) * 100, 0)}% of gross; the rest is absorbed by other buyers`],
      ["Hardest hit vs size", worst ? worst.t : "—", worst ? `−${fmt(worst.pct)}% of annual revenue` : ""],
      ["Biggest winner", best && best.total < 0 ? best.t : "—", best && best.total < 0 ? `+$${fmt(best.gain)}B from on-site power` : "Raise on-site power to see winners"],
    ].map(([b, v, s]) => `<div class="tile"><b>${b}</b><span class="v">${v}</span><small>${esc(s)}</small></div>`).join("");
  }
  function cats() {
    document.getElementById("u2Cats").innerHTML = D.cats.map((c) => `<div><b><i style="background:${CC[c.id]}"></i>${esc(c.n)}</b><span>~$${fmt(c.perGW)}B per GW · ${fmt(c.absorb * 100, 0)}% absorbed</span><p>${esc(c.why)}</p></div>`).join("") +
      `<div><b><i style="background:var(--up)"></i>On-site power workaround</b><span>~$${fmt(D.onsitePerGW)}B per GW self-supplied</span><p>States that make data centers pay for grid upgrades or refuse hook-ups push builders to behind-the-meter gas turbines and fuel cells, which come online in months instead of years.</p></div>`;
  }
  function sliders() {
    const defs = [
      ["delayGW", "US GW delayed, next 12 months", 0, 25, 0.5, (v) => fmt(v) + " GW", "Default ≈ a quarter of the hostile-state pipeline on the map; UBS sees ~30% of 2028 additions at risk"],
      ["recapture", "Recaptured in friendly states or abroad", 0, 90, 5, (v) => v + "%", "Capacity re-sited within the year (Louisiana, Oklahoma, North Dakota, overseas)"],
      ["selfPower", "GW switched to on-site power", 0, 15, 0.5, (v) => fmt(v) + " GW", "New US capacity that self-supplies to clear ratepayer rules"],
    ];
    const el = document.getElementById("u2Sl");
    el.innerHTML = defs.map(([k, n, a, b, s, f, w]) => `<div><label for="u2S-${k}">${n}<output id="u2O-${k}"></output></label><input id="u2S-${k}" type="range" min="${a}" max="${b}" step="${s}" value="${D.defaults[k]}"><small>${esc(w)}</small></div>`).join("");
    defs.forEach(([k, , , , , f]) => {
      const i = document.getElementById("u2S-" + k), o = document.getElementById("u2O-" + k);
      P[k] = +i.value; o.textContent = f(P[k]);
      i.oninput = () => { P[k] = +i.value; o.textContent = f(P[k]); render(); };
    });
    const m = document.getElementById("u2Mode");
    m.querySelectorAll("button").forEach((b) => (b.onclick = () => { mode = b.dataset.v; m.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(); }));
  }
  function render() { const M = model(); kpis(M); sankey(M); table(M); }

  Promise.all([
    fetch("../data/dc-supply-impact.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("../data/us-datacenters.json", { cache: "no-cache" }).then((r) => r.json()),
  ]).then(([d, u]) => {
    D = d; U = u;
    sliders(); cats(); render();
    document.getElementById("u2Note").textContent = D.note + " As of " + D.asofText + ".";
  }).catch(() => { host.innerHTML = `<p class="note">Second-order impact data could not load.</p>`; });
})();
