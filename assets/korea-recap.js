/* Korea bond market recap at the top of the Korea tab (port of assets/china-recap.js).
   Narrative, data-release table and bucket views live in data/korea-recap.json (rewritten by Claude
   after each KOFIA close, scheduled task "Stock dashboard: daily Korea bond recap"). Every yield,
   bp change, spread and 1-year range here is computed from the same KOFIA tenor history the page's
   curves use (data/korea.json), so the numbers always match the charts. */
(function () {
  const box = document.getElementById("crecap");
  if (!box) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const get = (u) => fetch(u + "?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const ISS = { ktb: "KTB", msb: "MSB", kdb: "KDB", ibk: "IBK", kexim: "KEXIM", bank: "Bank AAA", cd: "CD", cp: "CP", aa: "Corp AA-", bbb: "Corp BBB-", kepco: "KEPCO" };
  const GROUPS = [["ktb", "Korea Treasury Bonds (KTB)"], ["msb", "Monetary Stabilisation Bonds (MSB)"], ["kdb", "Korea Development Bank (KDB, fitted)"], ["ibk", "Industrial Bank of Korea (IBK, fitted)"], ["kexim", "Export-Import Bank of Korea (KEXIM, fitted)"], ["bank", "AAA bank debentures (fitted)"], ["cd", "Money market"], ["aa", "Corporate credit (KOFIA 3Y)"]];
  const TONE = { Rich: "rich", Cheap: "cheap", Fair: "fair" };
  const shift = (iso, days) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
  const ord = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  const bp = (v, sign = true) => v == null || !isFinite(v) ? "—" : (sign ? (v > 0.05 ? "+" : v < -0.05 ? "−" : "±") : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "bp";

  Promise.all([get(box.dataset.src || "../data/korea-recap.json"), get(box.dataset.china || "../data/korea.json")]).then(([r, c]) => {
    if (!r) return;
    // key "cdb:10" -> Map(date -> yield)
    const cache = {};
    const ser = (key) => {
      if (cache[key]) return cache[key];
      const [iss, ten] = key.split(":");
      // money market / credit series live under c.mm.series, keyed by name (cd, cp, aa3y, bbb3y, kepco3y)
      const MMK = { cd: "cd", cp: "cp", aa: "aa3y", bbb: "bbb3y", kepco: "kepco3y" };
      if (MMK[iss]) return (cache[key] = new Map((c?.mm?.series?.[MMK[iss]] || []).map(([d, y]) => [d, y])));
      const t = c && (iss === "ktb" ? c.tenors : iss === "bank" ? c.ncd && c.ncd.tenors : c.pb && c.pb[iss] && c.pb[iss].tenors);
      return (cache[key] = new Map(((t && t[ten]) || []).map(([d, y]) => [d, y])));
    };
    const dates = ((c && c.tenors && c.tenors["10"]) || []).map((x) => x[0]).filter((d) => d <= r.session);
    const at = (key, d) => { const s = ser(key); for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= d && s.has(dates[i])) return s.get(dates[i]); return null; };
    const last = dates[dates.length - 1], prev = dates[dates.length - 2], wk = dates.filter((d) => d <= shift(r.session, -7)).pop();

    // Closing levels table
    const rows = r.rows || {};
    let tbl = "";
    for (const [iss, gName] of GROUPS) {
      const ks = Object.keys(rows).filter((k) => iss === "cd" ? /^(cd|cp):/.test(k) : iss === "aa" ? /^(aa|bbb|kepco):/.test(k) : k.startsWith(iss + ":")).sort((a, b) => +a.split(":")[1] - +b.split(":")[1]);
      if (!ks.length) continue;
      tbl += `<div class="cr-g">${gName}</div>`;
      for (const k of ks) {
        const [ki, ten] = k.split(":"), y = at(k, last);
        const d1 = y != null && at(k, prev) != null ? (y - at(k, prev)) * 100 : null;
        const w1 = y != null && wk && at(k, wk) != null ? (y - at(k, wk)) * 100 : null;
        let sp = "";
        // spread vs the KTB at the same tenor (below 1Y: vs the KTB 1Y)
        if (iss !== "ktb") { const g = at("ktb:" + Math.max(1, +ten), last); sp = y != null && g != null ? bp((y - g) * 100, false) : "—"; }
        const tl = +ten < 1 ? Math.round(+ten * 12) + "M" : ten + "Y";
        tbl += `<div class="cr-r"><span class="cr-n">${ISS[ki]} ${tl}</span><span class="cr-v">${y == null ? "—" : y.toFixed(3) + "%"}</span>` +
          `<span class="cr-c">${bp(d1)}</span><span class="cr-c">${bp(w1)}</span><span class="cr-c">${iss === "ktb" ? "" : sp}</span>` +
          `<span class="cr-t">${esc(rows[k].note || "")}</span></div>`;
      }
    }

    // Richness metric for a bucket, over the last year of KOFIA history
    const metric = (m) => {
      if (!m) return null;
      const f = m.type === "lvl" ? (d) => at(m.a, d) : m.type === "spr" ? (d) => { const a = at(m.a, d), b = at(m.b, d); return a == null || b == null ? null : (b - a) * 100; }
        : (d) => { const a = at(m.a, d), b = at(m.b, d), cc = at(m.c, d); return a == null || b == null || cc == null ? null : (2 * b - a - cc) * 100; };
      const from = shift(last, -365), v = dates.filter((d) => d >= from).map(f).filter((x) => x != null);
      if (!v.length) return null;
      const cur = v[v.length - 1], lo = Math.min(...v), hi = Math.max(...v), avg = v.reduce((s, x) => s + x, 0) / v.length;
      const pct = Math.round((v.filter((x) => x <= cur).length / v.length) * 100);
      const nm = (k) => { const [i, t] = k.split(":"); return `${ISS[i]} ${t}Y`; };
      const label = m.type === "lvl" ? `${nm(m.a)} yield` : m.type === "spr" ? `${nm(m.b)} − ${nm(m.a)}` : `${m.a.split(":")[1]}s${m.b.split(":")[1]}s${m.c.split(":")[1]}s fly (2×${nm(m.b)} − ${nm(m.a)} − ${nm(m.c)})`;
      const fmt = (x) => (m.type === "lvl" ? x.toFixed(3) + "%" : bp(x, false));
      return { label, cur: fmt(cur), lo: fmt(lo), hi: fmt(hi), avg: fmt(avg), pct, pos: hi > lo ? ((cur - lo) / (hi - lo)) * 100 : 50 };
    };
    const buckets = (r.buckets || []).map((b) => {
      const s = metric(b.m), tone = TONE[b.tag] || "fair";
      const meter = s ? `<div class="cr-m"><div class="cr-ml">${esc(s.label)}: <b>${s.cur}</b> · 1Y avg ${s.avg} · range ${s.lo} to ${s.hi} · ${ord(s.pct)} percentile</div>` +
        `<div class="cr-bar" aria-hidden="true"><i style="left:${Math.max(0, Math.min(100, s.pos)).toFixed(1)}%"></i></div><div class="cr-bl"><span>Rich (1Y low)</span><span>Cheap (1Y high)</span></div></div>` : "";
      return `<div class="cr-b"><div class="cr-bh"><b>${esc(b.name)}</b><span class="cr-tag ${tone}">${esc(b.tag)}</span><span class="cr-st">${esc(b.stance)}</span></div>` +
        `${meter}<p>${esc(b.why)}</p><p class="cr-call"><b>Call:</b> ${esc(b.call)}</p></div>`;
    }).join("");

    const drivers = (r.drivers || []).map(([h, t]) => `<li><b>${esc(h)}.</b> ${esc(t)}</li>`).join("");
    const data = (r.data || []).map(([n, v, i]) => `<tr><td>${esc(n)}</td><td>${esc(v)}</td><td>${esc(i)}</td></tr>`).join("");
    const src = (r.sources || []).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ");
    const curveDate = last ? new Date(last + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";
    const sg = (sec) => new Date(sec * 1000).toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const dd = (t) => new Date(t.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    const upd = [c?.updated ? `<b>Last updated ${esc(sg(c.updated))} SGT</b>` : "",
      curveDate ? `KOFIA close: ${esc(curveDate)}` : "",
      c?.tradeDay ? `OTC trades to the ${esc(dd(c.tradeDay))} close` : "",
      r.commentary_asof ? `commentary ${esc(r.commentary_asof)}` : ""].filter(Boolean).join(" · ");
    box.innerHTML =
      (upd ? `<p class="cr-upd">${upd}</p>` : "") +
      `<div class="eyebrow">Korea bond market · KOFIA close ${esc(r.asof)}</div>` +
      `<h2>${esc(r.headline)}</h2>` +
      `<p class="cr-sum">${esc(r.summary)}</p>` +
      `<ul class="cr-dr">${drivers}</ul>` +
      (data ? `<h3 class="cr-h3">Korea data and what it means for bonds</h3><div class="cr-dwrap"><table class="cr-dt"><thead><tr><th>Release</th><th>Result (forecast, prior)</th><th>Bond and economic impact</th></tr></thead><tbody>${data}</tbody></table></div>` : "") +
      (r.view ? `<p class="cr-view"><b>${esc(r.view[0])}</b> ${esc(r.view[1])}</p>` : "") +
      (buckets ? `<h3 class="cr-h3">Bucket richness and calls <span>(${esc(r.horizon || "1–2 weeks")})</span></h3><div class="cr-bk">${buckets}</div>` : "") +
      `<details class="cr-all"><summary>Closing levels: KTB, MSB, policy banks, bank debentures, money market and credit</summary>` +
      `<div class="cr-tbl" role="table" aria-label="KOFIA closing yields"><div class="cr-r cr-hd"><span>Bond</span><span>Yield</span><span>Day</span><span>Week</span><span>vs KTB</span><span>Read</span></div>${tbl}</div></details>` +
      (r.watch ? `<p class="cr-note">${esc(r.watch)}</p>` : "") +
      `<p class="cr-src">Summary, quant read and views by Claude after the KOFIA close. Yields, changes, spreads and 1-year ranges are computed on this page from the KOFIA quotes and the dashboard\'s fitted curves${curveDate ? " (latest " + curveDate + ")" : ""}; "Rich" means expensive (yield low against its own history or neighbours). Commentary from: ${src}. Market views, not investment advice.</p>`;
    box.hidden = false;
  });
})();
