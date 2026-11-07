/* US data center map on the Datacenter page (#usdc).
   - Interactive map of major US AI data center campuses: owner, status (operating / under construction /
     planned / blocked) and power. Colour by owner or status, filter owners, shade states by political risk tier.
   - Click a state: its risk read, the campuses there and arrows to the friendlier states projects could move to.
   - At-risk table by company (GW in hostile states, by stage) and a cost model with sliders: delay, relocation,
     lost sales-tax exemptions, self-funded power and community costs, as $B and as % of 2026 capex.
   - Company views and a dated developments log, refreshed daily by a scheduled task.
   Data: data/us-datacenters.json (sites, risk tiers, assumptions, views, dev log) and data/datacenter.json (capex).
   Libraries: d3 + topojson-client (cdnjs) and us-atlas states (jsdelivr). */
(function () {
  const host = document.getElementById("usdc");
  if (!host) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
  const ST = { op: "Operating", uc: "Under construction", pl: "Planned", bl: "Blocked / dropped" };
  const STC = { op: "var(--up)", uc: "var(--accent)", pl: "#d08a1c", bl: "var(--down)" };
  const TIER = { 1: "Friendly", 2: "Mostly friendly", 3: "Mixed", 4: "Hostile locally / conditional", 5: "Hostile statewide" };
  const NAME2 = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY" };
  const SNAME = Object.fromEntries(Object.entries(NAME2).map(([a, b]) => [b, a]));
  const fmt = (v, d = 1) => (v == null || isNaN(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

  const css = `
#usdc .mapwrap{position:relative}
#usdc svg.usmap{width:100%;height:auto;display:block;touch-action:manipulation}
#usdc .stp{stroke:var(--panel);stroke-width:.8;cursor:pointer;transition:fill .25s,opacity .25s}
#usdc .stp:hover{opacity:.85}
#usdc .stp.sel{stroke:var(--ink);stroke-width:1.6}
#usdc .dot{stroke:var(--panel);stroke-width:1;cursor:pointer;transition:opacity .2s,r .3s}
#usdc .dot.dim{opacity:.12}
#usdc .dot.bl{fill-opacity:.25!important;stroke-dasharray:2 2;stroke-width:1.4}
#usdc .arc{fill:none;stroke:var(--up);stroke-width:2;stroke-dasharray:5 5;animation:usdcdash 1.1s linear infinite;pointer-events:none}
#usdc .arclab{font:600 10px var(--f-mono);fill:var(--up);pointer-events:none}
@keyframes usdcdash{to{stroke-dashoffset:-20}}
@media (prefers-reduced-motion:reduce){#usdc .arc{animation:none}}
#usdc .rk{display:inline-block;width:12px;height:9px;border-radius:2px;vertical-align:middle;margin-right:5px}
#usdc .split{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:900px){#usdc .split{grid-template-columns:minmax(0,1fr)}}
#usdc .usside h3{font:700 19px/1.2 var(--f-display);margin:0 0 4px}
#usdc .tb{display:inline-block;font:600 10px var(--f-mono);letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:3px;color:#fff}
#usdc .sl{list-style:none;margin:10px 0 0;padding:0;max-height:330px;overflow:auto}
#usdc .sl li{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent);font-size:13.5px;cursor:pointer}
#usdc .sl li:hover{background:color-mix(in srgb,var(--accent-soft) 60%,transparent)}
#usdc .sl li>i{width:9px;height:9px;border-radius:50%;align-self:center}
#usdc .sl small{display:block;color:var(--muted);font-size:12px;line-height:1.35}
#usdc .sl .g{font:600 12.5px var(--f-mono);white-space:nowrap}
#usdc .mv{margin:10px 0 0;font-size:13px}
#usdc .mv b{font:600 10px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px}
#usdc .pill{display:inline-block;font:600 12px var(--f-mono);border:1px solid var(--up);color:var(--up);border-radius:4px;padding:2px 8px;margin:0 6px 6px 0;cursor:pointer;background:var(--panel)}
#usdc .tw{overflow-x:auto}
#usdc table.rt{width:100%;border-collapse:collapse;font-size:13px;min-width:640px}
#usdc .rt th{font:600 10px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:right;padding:6px;border-bottom:1px solid var(--line);cursor:pointer;white-space:nowrap}
#usdc .rt th:first-child,#usdc .rt td:first-child{text-align:left}
#usdc .rt td{text-align:right;padding:7px 6px;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent);font:500 13px var(--f-mono);font-variant-numeric:tabular-nums;vertical-align:top}
#usdc .rt td:first-child{font:600 13.5px var(--f-body)}
#usdc .rt td small{display:block;font:400 11.5px var(--f-body);color:var(--muted);white-space:normal}
#usdc .rt tr.on td{background:color-mix(in srgb,var(--accent-soft) 70%,transparent)}
#usdc .rt tr{cursor:pointer}
#usdc .gr{font:600 11px var(--f-mono);padding:2px 6px;border-radius:3px;white-space:nowrap}
#usdc .g-Low{background:color-mix(in srgb,var(--up) 18%,transparent);color:var(--up)}
#usdc .g-Medium,#usdc .g-Low-Medium{background:color-mix(in srgb,#d08a1c 20%,transparent);color:#b0700e}
#usdc .g-Medium-High,#usdc .g-High,#usdc .g-Very{background:color-mix(in srgb,var(--down) 18%,transparent);color:var(--down)}
#usdc .sliders{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:12px 18px;margin:0 0 14px}
#usdc .sliders label{display:block;font:600 10px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
#usdc .sliders output{float:right;font:600 12px var(--f-mono);color:var(--ink);letter-spacing:0;text-transform:none}
#usdc .sliders input[type=range]{width:100%;margin:4px 0;accent-color:var(--accent)}
#usdc .sliders small{display:block;font-size:11px;color:var(--muted);line-height:1.3}
#usdc .stk{display:flex;height:14px;border-radius:3px;overflow:hidden;gap:1px;min-width:80px}
#usdc .stk i{display:block}
#usdc .c0{background:var(--accent)}#usdc .c1{background:var(--nx)}#usdc .c2{background:#d08a1c}#usdc .c3{background:var(--s2)}#usdc .c4{background:var(--down)}
#usdc .vc{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:12px}
#usdc .vc article{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px;min-width:0}
#usdc .vc h3{font:700 17px/1.2 var(--f-display);margin:6px 0 6px}
#usdc .vc p{font-size:13.5px;margin:0 0 8px}
#usdc .vc ul{margin:0;padding-left:18px;font-size:13px;color:var(--muted)}
#usdc .dev{list-style:none;margin:0;padding:0}
#usdc .dev li{display:grid;grid-template-columns:86px minmax(0,1fr);gap:10px;padding:8px 0;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent);font-size:13.5px}
#usdc .dev li:first-child{border-top:0}
#usdc .dev li>span{min-width:0;overflow-wrap:anywhere}
#usdc .dev time{font:600 12px var(--f-mono);color:var(--muted)}
#usdc .dev .tk{font:600 10.5px var(--f-mono);border:1px solid var(--line);border-radius:3px;padding:1px 5px;margin-right:4px;color:var(--muted)}
#usdc .kpi{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:0 0 14px}
#usdc .split>*{min-width:0}
@media (max-width:620px){#usdc .ctl .cg{flex-wrap:wrap}#usdc .ctl .seg{flex-wrap:wrap;overflow:visible}#usdc .ctl .seg button{flex:1 1 auto}#usdc .dev li{grid-template-columns:minmax(0,1fr)}#usdc .split .panel{padding:12px}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  host.innerHTML = `
    <h2 id="usH">US data centers: who owns what, and who is at risk</h2>
    <p class="sub">Major AI campuses by owner and stage, shaded by how hostile each state has become after the Nov 3 elections. Tap a state for its risk read and where projects could move; tap a dot for the campus.</p>
    <div class="kpi" id="usK"></div>
    <details class="panel" id="usModo" style="margin:0 0 14px" hidden><summary></summary><div class="kpi" id="usMK" style="margin-top:10px"></div><ul class="bul" id="usMP"></ul></details>
    <div class="panel">
      <div class="ctl">
        <div class="cg"><span class="cgl">Colour</span><div class="seg" id="usCol"><button data-v="owner">Owner</button><button data-v="status">Status</button></div></div>
        <div class="cg"><span class="cgl">States</span><div class="seg" id="usSh"><button data-v="risk">Risk tier</button><button data-v="none">Plain</button></div></div>
        <div class="cg"><span class="cgl">Stage</span><div class="seg tg" id="usSt"></div></div>
      </div>
      <div class="flt" id="usOw" role="group" aria-label="Filter owners"></div>
      <div class="split">
        <div class="mapwrap" id="usMap"><p class="note">Loading map…</p></div>
        <div class="usside" id="usSide"></div>
      </div>
      <div class="leg" id="usLeg" style="margin-top:10px"></div>
      <p class="note" id="usNote"></p>
    </div>

    <section aria-labelledby="usRH" style="margin-top:28px">
      <h2 id="usRH">Who is at risk, and where they can go</h2>
      <p class="sub">All columns cover every tracked campus in any state; "In hostile states" shows how much of the unbuilt capacity sits in states rated hostile (tiers 4–5). Click a row to show that company on the map.</p>
      <div class="panel tw" id="usRisk"></div>
      <h3 style="margin:22px 0 4px">What each company says it will have</h3>
      <p class="sub">Company-wide capacity guidance from filings and earnings calls, including capacity not yet tied to a site. Units differ by company, so read the basis column before comparing.</p>
      <div class="panel tw" id="usGuide"></div>
    </section>

    <section aria-labelledby="usCH" style="margin-top:28px">
      <h2 id="usCH">What it costs to get around the rules</h2>
      <p class="sub">An estimate of the cost of each workaround: waiting out a pause, relocating, losing sales-tax exemptions, paying for your own power and community deals. Move the sliders to test assumptions.</p>
      <div class="panel">
        <div class="sliders" id="usSl"></div>
        <div class="leg" id="usCLeg"></div>
        <div class="tw" id="usCost"></div>
        <details style="margin-top:10px"><summary>How the estimate works</summary><div id="usHow"></div></details>
      </div>
    </section>

    <section aria-labelledby="usVH" style="margin-top:28px">
      <h2 id="usVH">Expert view by company</h2>
      <p class="sub" id="usVsub"></p>
      <div class="vc" id="usViews"></div>
    </section>

    <section aria-labelledby="usDH" style="margin-top:28px">
      <h2 id="usDH">Latest developments</h2>
      <p class="sub">Dated news on sites, state policy and company moves, updated daily.</p>
      <div class="panel"><ul class="dev" id="usDev"></ul></div>
      <ol class="srcs" id="usSrc" style="margin-top:14px"></ol>
    </section>`;

  const S = {
    col: store("usdc.col") || "owner", shade: store("usdc.shade") || "risk",
    stages: new Set(["op", "uc", "pl", "bl"]), owners: null, state: null, focus: null,
  };
  let D = null, CAPEX = {}, geo = null, proj = null, path = null, svg = null, tip = null;

  function seg(id, key, onChange) {
    const el = document.getElementById(id);
    el.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.v === S[key]));
      b.onclick = () => { S[key] = b.dataset.v; store("usdc." + key, S[key]); el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); onChange(); };
    });
  }
  const riskFill = (t) => ({ 1: "color-mix(in srgb,var(--up) 34%,var(--panel))", 2: "color-mix(in srgb,var(--up) 16%,var(--panel))", 3: "color-mix(in srgb,var(--line) 70%,var(--panel))", 4: "color-mix(in srgb,var(--down) 22%,var(--panel))", 5: "color-mix(in srgb,var(--down) 44%,var(--panel))" }[t] || "color-mix(in srgb,var(--line) 70%,var(--panel))");
  const tierCol = (t) => ({ 1: "var(--up)", 2: "color-mix(in srgb,var(--up) 70%,var(--muted))", 3: "var(--muted)", 4: "color-mix(in srgb,var(--down) 75%,var(--muted))", 5: "var(--down)" }[t]);
  const nowGW = (s) => (s.now != null ? s.now : s.status === "op" ? s.gw : 0);
  const pipeGW = (s) => Math.max(0, s.gw - nowGW(s));
  const pipeSt = (s) => (s.status === "op" ? "uc" : s.status);
  const dotCol = (s) => (S.col === "owner" ? (D.owners[s.owner] || {}).c : STC[s.status]);
  const vis = (s) => S.stages.has(s.status) && (!S.owners || S.owners.has(s.owner));
  const tierOf = (code) => (D.risk[code] || {}).tier || 3;

  // ---------- map ----------
  function drawMap() {
    const W = 960, H = 600;
    proj = d3.geoAlbersUsa().fitExtent([[8, 8], [W - 8, H - 8]], geo);
    path = d3.geoPath(proj);
    const wrap = document.getElementById("usMap");
    wrap.innerHTML = "";
    svg = d3.select(wrap).append("svg").attr("class", "usmap").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Map of US data center campuses");
    svg.append("g").attr("class", "gS").selectAll("path").data(geo.features).join("path")
      .attr("class", "stp").attr("d", path)
      .on("click", (e, f) => { const c = NAME2[f.properties.name]; S.state = S.state === c ? null : c; S.focus = null; renderSide(); paint(); })
      .on("mousemove", (e, f) => { const c = NAME2[f.properties.name], r = D.risk[c]; if (!r) return; showTip(e, `<b>${esc(f.properties.name)}</b><div class="tr"><i class="rk" style="background:${tierCol(r.tier)}"></i>${TIER[r.tier]}<span>tier ${r.tier}/5</span></div><small>${esc(r.why)}</small><div class="hint">Tap for sites and where to move</div>`); })
      .on("mouseleave", hideTip);
    svg.append("g").attr("class", "gA");
    const sites = D.sites.filter((s) => !s.unsited && proj([s.lon, s.lat])).sort((a, b) => b.gw - a.gw);
    const rS = d3.scaleSqrt().domain([0, 11]).range([3.5, 30]);
    svg.append("g").attr("class", "gD").selectAll("circle").data(sites, (s) => s.id).join("circle")
      .attr("class", (s) => "dot" + (s.status === "bl" ? " bl" : ""))
      .attr("cx", (s) => proj([s.lon, s.lat])[0]).attr("cy", (s) => proj([s.lon, s.lat])[1]).attr("r", (s) => rS(Math.min(s.gw, 11)))
      .attr("tabindex", 0)
      .on("mousemove", (e, s) => showTip(e, siteTip(s)))
      .on("mouseleave", hideTip)
      .on("click", (e, s) => { e.stopPropagation(); S.state = s.state; S.focus = s.id; renderSide(); paint(); showTip(e, siteTip(s)); })
      .on("keydown", (e, s) => { if (e.key === "Enter") { S.state = s.state; S.focus = s.id; renderSide(); paint(); } });
    paint();
  }
  function siteTip(s) {
    const o = D.owners[s.owner] || {}, r = D.risk[s.state] || {};
    return `<b>${esc(s.name)}</b><small>${esc(SNAME[s.state] || s.state)} · ${esc(o.n)}${s.partner ? " · " + esc(s.partner) : ""}</small>
      <div class="tr"><i class="sw" style="background:${STC[s.status]}"></i>${ST[s.status]}<span>${s.est ? "~" : ""}${fmt(s.gw, s.gw < 1 ? 2 : 1)} GW planned</span></div>
      ${s.now != null ? `<div class="tr">Operating now<span>${fmt(s.now, 2)} GW</span></div>` : ""}
      ${s.capexB ? `<div class="tr">Announced cost<span>$${fmt(s.capexB, 1)}B</span></div>` : ""}
      <div class="tr"><i class="rk" style="background:${tierCol(r.tier)}"></i>State risk<span>${TIER[r.tier] || "—"}</span></div>
      <small style="margin-top:6px">${esc(s.note)}</small>`;
  }
  function paint() {
    if (!svg) return;
    svg.selectAll(".stp").attr("fill", (f) => (S.shade === "risk" ? riskFill(tierOf(NAME2[f.properties.name])) : "color-mix(in srgb,var(--line) 70%,var(--panel))"))
      .classed("sel", (f) => NAME2[f.properties.name] === S.state);
    svg.selectAll(".dot").attr("fill", dotCol).attr("stroke", (s) => (s.status === "bl" ? dotCol(s) : null))
      .classed("dim", (s) => !vis(s));
    // arrows from selected state to destination states
    const gA = svg.select(".gA"); gA.selectAll("*").remove();
    const r = S.state && D.risk[S.state];
    if (r && r.tier >= 4) {
      const cen = (c) => { const f = geo.features.find((x) => NAME2[x.properties.name] === c); return f ? path.centroid(f) : null; };
      const a = cen(S.state);
      r.to.filter((c) => c && c !== "—").forEach((raw) => {
        const c = raw.replace("*", ""), b = cen(c); if (!a || !b) return;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.35;
        gA.append("path").attr("class", "arc").attr("d", `M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}`);
        gA.append("circle").attr("cx", b[0]).attr("cy", b[1]).attr("r", 5).attr("fill", "var(--up)");
        gA.append("text").attr("class", "arclab").attr("x", b[0] + 7).attr("y", b[1] - 6).text(c);
      });
    }
    renderLegend();
  }
  function renderLegend() {
    const L = document.getElementById("usLeg");
    let h = "";
    if (S.col === "status") h += Object.entries(ST).map(([k, n]) => `<span><i style="background:${STC[k]}"></i>${n}</span>`).join("");
    else h += `<span>Dot size = GW · dashed ring = blocked or dropped</span>`;
    if (S.shade === "risk") h += [1, 2, 3, 4, 5].map((t) => `<span><i style="background:${riskFill(t)};border:1px solid var(--line)"></i>${TIER[t]}</span>`).join("");
    L.innerHTML = h;
  }
  function renderSide() {
    const el = document.getElementById("usSide");
    if (!S.state) {
      const top = Object.entries(D.risk).filter(([, r]) => r.tier >= 4).map(([c]) => c)
        .map((c) => ({ c, gw: D.sites.filter((s) => s.state === c).reduce((a, s) => a + pipeGW(s), 0) }))
        .filter((x) => x.gw > 0).sort((a, b) => b.gw - a.gw);
      el.innerHTML = `<h3>Hostile states, by capacity at risk</h3><p class="note" style="margin:0">Not-yet-operating GW on the map. Tap a state to drill in.</p>
        <ul class="sl">${top.map((x) => `<li data-s="${x.c}"><i style="background:${tierCol(tierOf(x.c))};border-radius:2px"></i><span>${esc(SNAME[x.c])}<small>${TIER[tierOf(x.c)]} · moves to ${esc(D.risk[x.c].to.join(", "))}</small></span><span class="g">${fmt(x.gw)} GW</span></li>`).join("")}</ul>`;
      el.querySelectorAll("li[data-s]").forEach((li) => (li.onclick = () => { S.state = li.dataset.s; renderSide(); paint(); }));
      return;
    }
    const r = D.risk[S.state] || { tier: 3, why: "No assessment.", to: [] };
    const ss = D.sites.filter((s) => s.state === S.state).sort((a, b) => b.gw - a.gw);
    const by = (k) => ss.filter((s) => s.status === k).reduce((a, s) => a + s.gw, 0);
    el.innerHTML = `<h3>${esc(SNAME[S.state] || S.state)}</h3>
      <span class="tb" style="background:${tierCol(r.tier)}">${TIER[r.tier]} · ${r.tier}/5</span>
      <p style="font-size:13.5px;margin:8px 0 0">${esc(r.why)}</p>
      ${ss.length ? `<p class="note">${fmt(by("op"))} GW operating · ${fmt(by("uc"))} GW building · ${fmt(by("pl"))} GW planned · ${fmt(by("bl"))} GW blocked</p>` : `<p class="note">No tracked campuses here.</p>`}
      ${r.tier >= 4 && r.to.length ? `<div class="mv"><b>Friendlier states nearby</b>${r.to.filter((c) => c !== "—").map((c) => { const k = c.replace("*", ""); return `<span class="pill" data-s="${k}">${k}${c.includes("*") ? " (if eased)" : ""}</span>`; }).join("")}</div>` : ""}
      <ul class="sl">${ss.map((s) => `<li data-id="${s.id}" style="${S.focus === s.id ? "background:var(--accent-soft)" : ""}"><i style="background:${dotCol(s)}"></i><span>${esc(s.name)}<small>${esc(D.owners[s.owner].n)} · ${ST[s.status]} · ${esc(s.note)}</small></span><span class="g">${s.est ? "~" : ""}${fmt(s.gw, s.gw < 1 ? 2 : 1)} GW</span></li>`).join("")}</ul>
      <p class="note"><a href="#usdc" id="usBack">← All hostile states</a></p>`;
    el.querySelectorAll(".pill").forEach((p) => (p.onclick = () => { S.state = p.dataset.s; renderSide(); paint(); }));
    el.querySelectorAll("li[data-id]").forEach((li) => (li.onclick = () => { S.focus = li.dataset.id; renderSide(); paint(); }));
    document.getElementById("usBack").onclick = (e) => { e.preventDefault(); S.state = null; S.focus = null; renderSide(); paint(); };
  }
  function showTip(e, html) {
    if (!tip) { tip = document.createElement("div"); tip.className = "ctip"; document.body.appendChild(tip); }
    tip.innerHTML = html; tip.style.display = "block";
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.pageX + pad, y = e.pageY + pad;
    if (x + w > window.scrollX + document.documentElement.clientWidth - 8) x = e.pageX - w - pad;
    if (x < 8) x = 8;
    if (y + h > window.scrollY + window.innerHeight - 8) y = e.pageY - h - pad;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { if (tip) tip.style.display = "none"; }
  document.addEventListener("click", (e) => { if (tip && !host.contains(e.target)) hideTip(); });

  // ---------- controls ----------
  function controls() {
    seg("usCol", "col", () => { paint(); renderSide(); });
    seg("usSh", "shade", paint);
    const stEl = document.getElementById("usSt");
    stEl.innerHTML = Object.entries(ST).map(([k, n]) => `<button data-k="${k}" aria-pressed="true"><i class="sw" style="background:${STC[k]}"></i>${n.split(" ")[0]}</button>`).join("");
    stEl.querySelectorAll("button").forEach((b) => (b.onclick = () => { const k = b.dataset.k; if (S.stages.has(k) && S.stages.size > 1) S.stages.delete(k); else S.stages.add(k); b.setAttribute("aria-pressed", String(S.stages.has(k))); paint(); }));
    const ow = document.getElementById("usOw");
    const used = [...new Set(D.sites.map((s) => s.owner))];
    ow.innerHTML = `<button data-o="*" aria-pressed="true">All owners</button>` + used.map((o) => `<button data-o="${o}" aria-pressed="false"><i class="sw" style="background:${D.owners[o].c};display:inline-block;margin-right:5px"></i>${esc(D.owners[o].n)}</button>`).join("");
    ow.querySelectorAll("button").forEach((b) => (b.onclick = () => setOwner(b.dataset.o)));
  }
  function setOwner(o) {
    const ow = document.getElementById("usOw");
    if (o === "*") S.owners = null;
    else { if (!S.owners) S.owners = new Set(); S.owners.has(o) ? S.owners.delete(o) : S.owners.add(o); if (!S.owners.size) S.owners = null; }
    ow.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.o === "*" ? !S.owners : !!(S.owners && S.owners.has(b.dataset.o)))));
    paint();
    document.querySelectorAll("#usRisk tr[data-o]").forEach((tr) => tr.classList.toggle("on", !!(S.owners && S.owners.has(tr.dataset.o))));
  }

  // ---------- exposure & cost ----------
  const COS = ["msft", "amzn", "googl", "meta", "orcl", "sbank", "spcx", "crwv", "nbis", "iren", "apld", "glxy", "cifr", "frmi"];
  function exposure(o) {
    const at = D.sites.filter((s) => s.owner === o && pipeGW(s) > 0 && tierOf(s.state) >= 4);
    const g = (k) => at.filter((s) => pipeSt(s) === k).reduce((a, s) => a + pipeGW(s), 0);
    const all = D.sites.filter((s) => s.owner === o).reduce((a, s) => a + s.gw, 0);
    const pipe = D.sites.filter((s) => s.owner === o).reduce((a, s) => a + pipeGW(s), 0);
    const states = [...new Set(at.map((s) => s.state))];
    const home = [...new Set(D.sites.filter((s) => s.owner === o && tierOf(s.state) <= 2).map((s) => s.state))];
    const to = [...new Set([...home, ...states.flatMap((c) => (D.risk[c].to || []).map((x) => x.replace("*", "")).filter((x) => x !== "—" && tierOf(x) <= 3))])].slice(0, 5);
    const cur = D.sites.filter((s) => s.owner === o).reduce((a, s) => a + nowGW(s), 0);
    const allPipe = D.sites.filter((s) => s.owner === o).reduce((a, s) => a + pipeGW(s), 0);
    const ga = (k) => D.sites.filter((s) => s.owner === o && pipeSt(s) === k).reduce((a, s) => a + pipeGW(s), 0);
    const hostile = at.reduce((a, s) => a + pipeGW(s), 0);
    const tg = (D.guide || {})[o] || {}, unsited = tg.gwTarget ? Math.max(0, tg.gwTarget - cur - allPipe) : 0;
    return { uc: g("uc"), pl: g("pl"), bl: g("bl"), aUc: ga("uc"), aPl: ga("pl"), aBl: ga("bl"), hostile, unsited, tgBy: tg.targetBy, all, pipe, cur, allPipe, states, to, at };
  }
  const P = {};
  function sliders() {
    const A = D.assump;
    const defs = [
      ["pauseDelay", "Pause / permit delay", 0, 24, 1, (v) => v + " mo", A.pauseDelay.why],
      ["relocDelay", "Relocation delay", 6, 30, 1, (v) => v + " mo", A.relocDelay.why],
      ["reloc", "Share of planned GW relocated", 0, 100, 5, (v) => v + "%", "Rest waits out the pause and pays new state costs"],
      ["selfPower", "Self-funded power & grid", 0, 3, 0.1, (v) => "$" + v.toFixed(1) + "B/GW", A.selfPower.why],
      ["wacc", "Cost of capital", 6, 14, 0.5, (v) => v.toFixed(1) + "%", A.wacc.why],
      ["tax", "Sales-tax exemption lost", 0, 1, 1, (v) => (v ? "Yes" : "No"), "Hinojosa and Ohio both target the equipment exemption"],
    ];
    const init = { pauseDelay: A.pauseDelay.v, relocDelay: A.relocDelay.v, reloc: 40, selfPower: A.selfPower.v, wacc: A.wacc.v * 100, tax: 1 };
    const el = document.getElementById("usSl");
    el.innerHTML = defs.map(([k, n, a, b, s, f, w]) => `<div><label for="usS-${k}">${n}<output id="usO-${k}"></output></label><input id="usS-${k}" type="range" min="${a}" max="${b}" step="${s}" value="${init[k]}"><small>${esc(w)}</small></div>`).join("");
    defs.forEach(([k, , , , , f]) => {
      const i = document.getElementById("usS-" + k), out = document.getElementById("usO-" + k);
      const set = () => { P[k] = +i.value; out.textContent = f(P[k]); costTable(); };
      i.oninput = set; P[k] = +i.value; out.textContent = f(P[k]);
    });
  }
  function cost(o) {
    const A = D.assump, e = exposure(o);
    const w = P.wacc / 100, cap = A.capexPerGW.v, ebitda = A.revPerGW.v * A.margin.v;
    const ann = (1 - Math.pow(1 + w, -6)) / w; // 6-year asset life
    const defer = (m) => ebitda * ann * (1 - Math.pow(1 + w, -m / 12)); // time value lost on the whole cash-flow stream
    const carry = (share, m) => cap * share * w * m / 12; // capital already committed sitting idle
    const tax = P.tax ? cap * A.equipShare.v * A.salesTax.v : 0;
    const r = P.reloc / 100;
    // Under construction: grandfathered for construction but 50% odds of a state permit / power delay; half the equipment still to buy.
    const ucDelay = e.uc * 0.5 * (defer(P.pauseDelay) + carry(0.4, P.pauseDelay));
    const ucComply = e.uc * (0.5 * tax + 0.5 * P.selfPower + A.community.v);
    // Planned: r relocates (write-off + relocation delay, no new-state costs); 1−r waits out the pause and pays the new costs.
    const plDelay = e.pl * ((1 - r) * (defer(P.pauseDelay) + carry(0.05, P.pauseDelay)) + r * defer(P.relocDelay));
    const plReloc = e.pl * r * A.sunk.v;
    const plComply = e.pl * (1 - r) * (tax + P.selfPower + A.community.v);
    // Blocked: must relocate.
    const blReloc = e.bl * A.sunk.v, blDelay = e.bl * defer(P.relocDelay);
    const parts = [ucDelay + plDelay + blDelay, plReloc + blReloc, (e.uc * 0.5 + e.pl * (1 - r)) * tax, (e.uc * 0.5 + e.pl * (1 - r)) * P.selfPower, (e.uc + e.pl * (1 - r)) * A.community.v];
    const tot = parts.reduce((a, b) => a + b, 0);
    return { e, parts, tot, capex: CAPEX[o] };
  }
  const CL = ["Delay (time value + idle capital)", "Relocation write-offs", "Lost sales-tax exemption", "Self-funded power & grid", "Water, community, labour"];
  function costTable() {
    const rows = COS.map((o) => ({ o, ...cost(o) })).sort((a, b) => b.tot - a.tot);
    const mx = Math.max(...rows.map((r) => r.tot), 0.01);
    document.getElementById("usCLeg").innerHTML = CL.map((n, i) => `<span><i class="c${i}"></i>${n}</span>`).join("");
    document.getElementById("usCost").innerHTML = `<table class="rt"><thead><tr><th>Company</th><th>GW exposed</th><th style="min-width:160px">Cost mix</th><th>Total $B</th><th>% of '26 capex</th></tr></thead><tbody>${rows.map((r) => {
      const gw = r.e.uc + r.e.pl + r.e.bl;
      const pct = r.capex ? (r.tot / r.capex) * 100 : null;
      return `<tr data-o="${r.o}"><td>${esc(D.owners[r.o].n)}<small>${r.e.states.length ? "In " + r.e.states.join(", ") : "No hostile-state pipeline"}</small></td>
        <td>${fmt(gw)}</td>
        <td><div class="stk" style="width:${Math.max(2, (r.tot / mx) * 100)}%" title="${r.parts.map((p, i) => CL[i] + ": $" + fmt(p) + "B").join("\n")}">${r.parts.map((p, i) => (p > 0 ? `<i class="c${i}" style="flex:${p}"></i>` : "")).join("")}</div></td>
        <td>${fmt(r.tot)}</td><td class="${pct > 10 ? "down" : ""}">${pct == null ? "—" : fmt(pct) + "%"}</td></tr>`;
    }).join("")}</tbody></table><p class="note">Capex from the "Capex this year" panel; private and non-covered names show —. Estimates, not company guidance.</p>`;
    document.querySelectorAll("#usCost tr[data-o]").forEach((tr) => (tr.onclick = () => { setOwner("*"); setOwner(tr.dataset.o); document.getElementById("usMap").scrollIntoView({ behavior: "smooth", block: "center" }); }));
  }
  function guideTable() {
    const G = D.guide || {}, el = document.getElementById("usGuide");
    if (!el || !Object.keys(G).length) return;
    const dfmt = (x) => new Date(x + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
    el.innerHTML = `<table class="rt"><thead><tr><th>Company</th><th style="text-align:left">Latest disclosed</th><th style="text-align:left">End-2026</th><th style="text-align:left">End-2027</th><th style="text-align:left">2028</th><th style="text-align:left">Basis and source</th></tr></thead><tbody>${COS.filter((o) => G[o]).map((o) => { const g = G[o];
      return `<tr><td>${esc(D.owners[o].n)}<small>${esc(D.owners[o].t)} · ${dfmt(g.d)}</small></td>${[g.now, g.y26, g.y27, g.y28].map((v) => `<td style="text-align:left;font-family:var(--f-body)">${esc(v)}</td>`).join("")}<td style="text-align:left;font-family:var(--f-body);min-width:260px"><small style="display:block">${esc(g.basis)} <a href="${esc(g.src)}" target="_blank" rel="noopener">source</a>${g.src2 ? ` · <a href="${esc(g.src2)}" target="_blank" rel="noopener">call</a>` : ""}</small></td></tr>`; }).join("")}</tbody></table>`;
  }
  function riskTable() {
    const rows = COS.map((o) => ({ o, ...exposure(o), v: D.views[o] || {} })).sort((a, b) => b.uc + b.pl + b.bl - (a.uc + a.pl + a.bl));
    document.getElementById("usRisk").innerHTML = `<table class="rt"><thead><tr><th>Company</th><th>Risk</th><th title="Operating today, all tracked campuses in any state">Current</th><th title="Not yet operating, all states">Building</th><th title="Not yet operating, all states">Planned</th><th title="Not yet operating, all states">Blocked</th><th title="Building + Planned + Blocked in tier 4–5 states">In hostile states</th><th>% of footprint at risk</th><th style="text-align:left">Can move to</th></tr></thead><tbody>${rows.map((r) => {
      const at = r.uc + r.pl + r.bl, pct = r.all ? (at / r.all) * 100 : 0;
      return `<tr data-o="${r.o}"><td>${esc(D.owners[r.o].n)}<small>${esc(D.owners[r.o].t)}${r.states.length ? " · " + r.states.join(", ") : ""}</small></td>
        <td><span class="gr g-${esc((r.v.grade || "").split(" ")[0])}">${esc(r.v.grade || "—")}</span></td>
        <td>${fmt(r.cur)}</td><td>${fmt(r.aUc)}</td><td>${fmt(r.aPl)}</td><td>${fmt(r.aBl)}</td><td class="${r.hostile > 0 ? "down" : ""}">${fmt(r.hostile)}</td><td class="${pct >= 50 ? "down" : ""}">${fmt(pct, 0)}%</td>
        <td style="text-align:left;font-family:var(--f-body)">${r.to.length ? r.to.map((c) => `<span class="pill" data-s="${c}" style="margin:0 4px 4px 0">${c}</span>`).join("") : "—"}</td></tr>`;
    }).join("")}</tbody></table><p class="note">All GW columns cover every tracked campus in any state (facility power); unbuilt phases of live campuses count as Building. In hostile states = the part of Building, Planned and Blocked in tier 4–5 states. Planned includes company targets not yet tied to a site where the company gives a GW figure and reported location (SpaceX, Texas), ~ estimates included. Footprint = all tracked planned GW. Tiers 4–5 = ${Object.keys(D.risk).filter((c) => D.risk[c].tier >= 4).sort().join(", ")}.</p>`;
    document.querySelectorAll("#usRisk tr[data-o]").forEach((tr) => (tr.onclick = (e) => {
      const pill = e.target.closest(".pill");
      if (pill) { S.state = pill.dataset.s; renderSide(); paint(); }
      else { setOwner("*"); setOwner(tr.dataset.o); }
      document.getElementById("usMap").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  }
  function views() {
    document.getElementById("usVsub").textContent = "Claude's read as a market researcher, as of " + D.asofText + ". Ordered by exposure.";
    const order = COS.map((o) => ({ o, e: exposure(o) })).sort((a, b) => b.e.uc + b.e.pl + b.e.bl - (a.e.uc + a.e.pl + a.e.bl));
    document.getElementById("usViews").innerHTML = order.map(({ o }) => { const v = D.views[o]; if (!v) return ""; return `<article><span class="tick">${esc(D.owners[o].t)}</span><span class="gr g-${esc(v.grade.split(" ")[0])}">${esc(v.grade)} risk</span><h3>${esc(D.owners[o].n)}</h3><p>${esc(v.view)}</p>${v.moves && v.moves.length ? `<ul>${v.moves.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}</article>`; }).join("");
  }
  function devs() {
    const dv = [...D.dev].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 25);
    const dfmt = (s) => { const d = new Date(s + "T00:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
    document.getElementById("usDev").innerHTML = dv.map((x) => `<li><time datetime="${x.d}">${dfmt(x.d)}</time><span>${x.co.filter((c) => c !== "*").map((c) => `<span class="tk">${esc((D.owners[c] || {}).t || c)}</span>`).join("")}${esc(x.t)} ${x.src ? `<a href="${esc(x.src)}" target="_blank" rel="noopener">source</a>` : ""}</span></li>`).join("");
    document.getElementById("usSrc").innerHTML = D.sources.map(([n, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a></li>`).join("");
  }
  function kpis() {
    const tot = (f) => D.sites.filter(f).reduce((a, s) => a + s.gw, 0);
    const sum = (f, v) => D.sites.filter(f).reduce((a, s) => a + v(s), 0);
    const atRisk = sum((s) => tierOf(s.state) >= 4, pipeGW), pipe = sum(() => true, pipeGW);
    const tx = sum((s) => s.state === "TX", pipeGW);
    document.getElementById("usK").innerHTML = [
      ["Campuses tracked", D.sites.filter((s) => !s.unsited).length, `${fmt(sum(() => true, nowGW), 0)} GW operating now (facility power)`],
      ["Pipeline in hostile states", fmt(atRisk) + " GW", `${fmt((atRisk / pipe) * 100, 0)}% of the ${fmt(pipe, 0)} GW pipeline tracked`],
      ["Texas pipeline", fmt(tx) + " GW", "Jefferies: ~13 GW at immediate risk; Modo: ~10 GW of expected build stopped, 24 GW under construction uncertain"],
      ["Blocked on Nov 3", fmt(tot((s) => s.status === "bl")) + " GW", "Ohio votes at Trenton, Piqua, Sunbury"],
    ].map(([b, v, s]) => `<div class="tile"><b>${b}</b><span class="v">${v}</span><small>${esc(s)}</small></div>`).join("");
    if (D.modo) {
      const m = D.modo, box = document.getElementById("usModo");
      box.hidden = false;
      box.querySelector("summary").innerHTML = `<b>Cross-check: Modo Energy national view</b> <small>(${esc(m.date)}, <a href="${esc(m.src)}" target="_blank" rel="noopener">source</a>)</small>`;
      document.getElementById("usMK").innerHTML = m.tiles.map(([b, v, t]) => `<div class="tile"><b>${esc(b)}</b><span class="v">${esc(v)}</span><small>${esc(t)}</small></div>`).join("");
      document.getElementById("usMP").innerHTML = m.pts.map((x) => `<li>${esc(x)}</li>`).join("");
    }
    document.getElementById("usNote").textContent = D.note + " As of " + D.asofText + ".";
    const A = D.assump;
    document.getElementById("usHow").innerHTML = `<ul class="bul" style="margin-top:6px">${Object.values(A).map((a) => `<li>${esc(a.why)}: default ${a.v}${a.u ? " " + a.u : ""} (range ${a.rng})</li>`).join("")}
      <li>Delay cost = the time value lost when a 6-year cash-flow stream starts later, plus the cost of capital already committed sitting idle (40% of capex for sites under construction, 5% for planned).</li>
      <li>Under-construction sites are assumed grandfathered for construction, with 50% odds of a state permit or power-service delay and half their equipment still to buy.</li>
      <li>Relocated GW writes off site-specific spend and waits the relocation delay, but keeps its tax exemption in the new state. Blocked sites must relocate.</li></ul>`;
  }

  function loadScript(src) { return new Promise((res, rej) => { if (src.includes("d3.min") && window.d3) return res(); if (src.includes("topojson") && window.topojson) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

  Promise.all([
    fetch("../data/us-datacenters.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("../data/datacenter.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => null),
  ]).then(([d, dc]) => {
    D = d;
    if (dc && dc.companies) dc.companies.forEach((c) => { if (c.capexV) CAPEX[c.id] = c.capexV; });
    controls(); sliders(); kpis(); riskTable(); guideTable(); costTable(); views(); devs(); renderSide(); renderLegend();
    return loadScript("https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js")
      .then(() => loadScript("https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js"))
      .then(() => fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then((r) => r.json()))
      .then((us) => { geo = topojson.feature(us, us.objects.states); geo.features = geo.features.filter((f) => NAME2[f.properties.name]); drawMap(); })
      .catch(() => { document.getElementById("usMap").innerHTML = `<p class="note">The map library could not load. The tables below still work.</p>`; });
  }).catch(() => { host.innerHTML = `<p class="note">US data center data could not load.</p>`; });
})();
