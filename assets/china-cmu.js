// China tab "CMU bonds": USD and CNH instruments lodged with Hong Kong's CMU (the Southbound Bond Connect settlement system).
// Reads ../data/cmu-bonds.json (written by scripts/fetch-cmu-bonds.mjs, daily in china-bonds.yml).
(() => {
  const SRC = "../data/cmu-bonds.json";
  const $ = (id) => document.getElementById(id);
  if (!$("cmBody")) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f = (v, n = 2) => v == null || !isFinite(v) ? "–" : (+v).toFixed(n);
  const sg = (v) => v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(+v).toFixed(0)}`;
  const cls = (v) => v == null || Math.abs(v) < 0.5 ? "" : v > 0 ? "up" : "down";
  const mn = (v) => v == null ? "–" : (v / 1e6).toLocaleString("en-US", { maximumFractionDigits: v < 1e7 ? 1 : 0 });
  const FREQ = { 1: "Monthly", 3: "Quarterly", 6: "Semi-annual", 12: "Annual" };
  const TYPES = [["core", "Bonds & FRNs"], ["All", "All"], ["Bond", "Bonds"], ["FRN", "FRNs"], ["CD / note ≤1Y", "CDs ≤1Y"], ["Discount note", "Discount"]];
  const PAGE = 300;
  const st = { q: "", ccy: "All", type: "core", mat: "1-99", sort: "mat", dir: 1, n: PAGE };
  let D = null;

  const COLS = [
    ["isin", "ISIN", (b) => `<td class="code">${esc(b.isin || "–")}</td>`],
    ["name", "Bond", (b) => `<td class="nm" title="${esc(b.name)}">${esc(b.name)}</td>`],
    ["issuer", "Issuer", (b) => `<td>${esc(b.issuer || "–")}</td>`],
    ["ccy", "Ccy", (b) => `<td>${b.ccy}</td>`],
    ["type", "Type", (b) => `<td>${esc(b.type)}</td>`],
    ["cpn", "Coupon %", (b) => `<td>${b.zero ? "0 (disc.)" : f(b.cpn, 3)}${b.frn ? "*" : ""}</td>`],
    ["yld", "Yield %", (b) => `<td><b>${f(b.yld, 3)}</b></td>`],
    ["ref", "Ref curve %", (b) => `<td>${f(b.ref, 3)}</td>`],
    ["spr", "Spread bp", (b) => `<td class="${cls(b.spr)}">${sg(b.spr)}</td>`],
    ["mat", "Maturity", (b) => `<td>${esc(b.mat)}</td>`],
    ["ttm", "Left (Y)", (b) => `<td>${f(b.ttm, 2)}</td>`],
    ["call", "Call / put", (b) => `<td>${esc(b.call || "–")}</td>`],
    ["issue", "Issued", (b) => `<td>${esc(b.issue || "–")}</td>`],
    ["next", "Next coupon", (b) => `<td>${esc(b.next || "–")}</td>`],
    ["freq", "Pays", (b) => `<td>${b.zero ? "–" : FREQ[b.freq] || (b.freq ? `${b.freq}M` : "–")}</td>`],
    ["out", "Outst. (mn)", (b) => `<td>${mn(b.out)}</td>`],
    ["minAmt", "Min trade", (b) => `<td>${b.minAmt == null ? "–" : b.minAmt.toLocaleString("en-US")}</td>`],
  ];

  function rows() {
    const q = st.q.trim().toLowerCase();
    const [lo, hi] = st.mat ? st.mat.split("-").map(Number) : [-1, 999];
    return (D?.bonds || []).filter((b) =>
      (!q || [b.isin, b.name, b.issuer, b.code].some((x) => String(x || "").toLowerCase().includes(q))) &&
      (st.ccy === "All" || b.ccy === st.ccy) &&
      (st.type === "All" || (st.type === "core" ? b.type === "Bond" || b.type === "FRN" : b.type === st.type)) &&
      b.ttm >= lo && b.ttm < hi)
      .sort((a, b) => {
        const x = a[st.sort], y = b[st.sort];
        if (x == null && y == null) return a.ttm - b.ttm;
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * st.dir || a.ttm - b.ttm;
      });
  }

  function btns(id, list, key) {
    $(id).innerHTML = list.map(([k, l]) => `<button type="button" data-k="${esc(k)}" aria-pressed="${k === st[key]}">${esc(l)}</button>`).join("");
    $(id).querySelectorAll("button").forEach((b) => b.onclick = () => { st[key] = b.dataset.k; st.n = PAGE; table(); });
  }

  function table() {
    const all = D?.bonds || [];
    const cnt = (c) => all.filter((b) => b.ccy === c).length;
    btns("cmCcy", [["All", `All (${all.length})`], ["USD", `USD (${cnt("USD")})`], ["CNH", `CNH (${cnt("CNH")})`]], "ccy");
    btns("cmType", TYPES, "type");
    $("cmHead").innerHTML = COLS.map(([k, l]) => `<th scope="col" data-k="${k}" ${st.sort === k ? `aria-sort="${st.dir > 0 ? "ascending" : "descending"}"` : ""} tabindex="0">${l}</th>`).join("");
    $("cmHead").querySelectorAll("th").forEach((th) => { const go = () => { const k = th.dataset.k; st.dir = st.sort === k ? -st.dir : 1; st.sort = k; table(); }; th.onclick = go; th.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });
    const R = rows();
    $("cmBody").innerHTML = R.length
      ? R.slice(0, st.n).map((b) => `<tr>${COLS.map((c) => c[2](b)).join("")}</tr>`).join("")
      : `<tr><td colspan="${COLS.length}" class="empty" style="text-align:left">${all.length ? "No bonds match." : "No CMU data yet — the list is built on the next daily China bond refresh (18:45 SGT)."}</td></tr>`;
    $("cmMore").hidden = R.length <= st.n;
    $("cmMore").textContent = `Show ${Math.min(PAGE, R.length - st.n)} more (${R.length - st.n} hidden)`;
    const u = D?.ref?.usd?.date, c1 = D?.ref?.cnh?.ncd?.date, c2 = D?.ref?.cnh?.cdb?.date;
    $("cmNote").innerHTML = `${R.length.toLocaleString()} of ${all.length.toLocaleString()} outstanding USD / CNH instruments shown${D?.totalCmu ? `, out of ${D.totalCmu.toLocaleString()} lodged with CMU in all currencies` : ""}. <b>Yield</b>: CMU publishes no prices, so this is the yield to maturity if bought at par, i.e. the coupon (* FRNs show their current reset coupon; discount notes have none). <b>Ref curve</b>: USD vs the US Treasury par curve${u ? ` (${u})` : ""}; CNH vs ChinaBond's AAA bank NCD curve up to 1Y${c1 ? ` (${c1})` : ""} and the China Development Bank curve beyond${c2 ? ` (${c2})` : ""}, read at each bond's remaining term. <b>Spread</b> is coupon minus that, a rough credit/new-issue premium, not a live spread. Being in CMU makes a bond settleable for Southbound Bond Connect; the bonds actually tradable through CFETS are a subset CFETS lists for its members. Click a column header to sort.`;
  }

  $("cmQ").oninput = (e) => { st.q = e.target.value; st.n = PAGE; table(); };
  $("cmMat").onchange = (e) => { st.mat = e.target.value; st.n = PAGE; table(); };
  $("cmMore").onclick = () => { st.n += PAGE; table(); };
  $("cmDl").onclick = () => {
    const head = ["isin", "cmu_code", "name", "issuer", "currency", "type", "coupon_pct", "yield_at_par_pct", "ref_curve_pct", "spread_bp", "issue_date", "maturity", "years_left", "call_put_date", "next_coupon", "freq_months", "issue_size", "outstanding", "min_tradable"];
    const q = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    const body = rows().map((b) => [b.isin, b.code, b.name, b.issuer, b.ccy, b.type, b.cpn, b.yld, b.ref, b.spr, b.issue, b.mat, b.ttm, b.call, b.next, b.freq, b.size, b.out, b.minAmt].map(q).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cmu-usd-cnh-bonds-${D?.asOf || "latest"}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  async function load() {
    try {
      const r = await fetch(`${SRC}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      D = await r.json();
      $("cmStamp").innerHTML = `<span><b>Last updated</b> ${esc(new Date(D.updated).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }))} SGT</span><span><b>Source</b> HKMA CMU instrument list</span>`;
    } catch { D = { bonds: [] }; $("cmStamp").textContent = "CMU bond list not built yet."; }
    table();
  }
  load();
  setInterval(load, 30 * 60e3);
})();
