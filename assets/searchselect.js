/* Type-to-search for long dropdowns.
   Any <select> with 12+ options (or data-search) gets a text box in front of it:
   tap it and type a tenor, bond code, name or yield (e.g. "10Y", "2500", "cdb 5y")
   and the list filters as you type. The real <select> stays in the page, hidden,
   and remains the source of truth: picking a row sets its value and fires "change",
   so page scripts keep working, and when a script rebuilds the options the box updates. */
(function () {
  const MIN = 12, MAX_ROWS = 200;
  const css = `
.ss{position:relative;display:inline-block;width:min(420px,72vw);vertical-align:middle}
.ss input{box-sizing:border-box;width:100%;font:500 12px var(--f-mono,ui-monospace,monospace);border:1px solid var(--line,#d9dee5);background:var(--panel,#fff);color:var(--ink,#141a22);padding:5px 26px 5px 8px;border-radius:4px;text-overflow:ellipsis}
.ss::after{content:"";position:absolute;right:10px;top:50%;width:6px;height:6px;margin-top:-5px;border-right:1.5px solid var(--muted,#5a6573);border-bottom:1.5px solid var(--muted,#5a6573);transform:rotate(45deg);pointer-events:none}
.ss input:focus-visible{outline:2px solid var(--accent,#0b6fb8);outline-offset:1px}
.ss input:disabled{opacity:.55}
.ss ul{position:absolute;z-index:50;left:0;right:0;top:calc(100% + 2px);max-height:min(320px,55vh);overflow:auto;margin:0;padding:4px 0;list-style:none;background:var(--panel,#fff);border:1px solid var(--line,#d9dee5);border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.18);-webkit-overflow-scrolling:touch}
.ss ul[hidden]{display:none}
.ss li{font:500 12px var(--f-mono,ui-monospace,monospace);color:var(--ink,#141a22);padding:7px 10px;cursor:pointer;white-space:normal;line-height:1.35}
.ss li.g{font-weight:600;color:var(--muted,#5a6573);cursor:default;padding:8px 10px 3px;font-size:11px;letter-spacing:.04em}
.ss li[aria-selected=true]{background:var(--accent-soft,#e3eff8)}
.ss li.cur{font-weight:600;color:var(--accent,#0b6fb8)}
.ss li.e{color:var(--muted,#5a6573);cursor:default}
@media (max-width:700px){.ss input,.ss li{font-size:16px}.ss li.g{font-size:12px}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  let uid = 0;
  // Lower-case, punctuation to spaces; tokens then match the start of a word ("5" finds 5Y, not 0.25)
  const norm = (s) => " " + (s || "").toLowerCase().replace(/[^a-z0-9.%\u4e00-\u9fff]+/g, " ").trim();

  function enhance(sel) {
    if (sel.dataset.ssDone || sel.multiple) return;
    if (sel.options.length < MIN && !("search" in sel.dataset)) return;
    sel.dataset.ssDone = "1";
    const id = "ss" + ++uid;
    const box = document.createElement("span"); box.className = "ss";
    const inp = document.createElement("input");
    Object.assign(inp, { type: "text", autocomplete: "off", spellcheck: false, placeholder: "Type to search…" });
    inp.setAttribute("role", "combobox"); inp.setAttribute("aria-expanded", "false"); inp.setAttribute("aria-controls", id);
    inp.setAttribute("aria-autocomplete", "list"); inp.setAttribute("autocapitalize", "off");
    inp.setAttribute("aria-label", (sel.getAttribute("aria-label") || "Choose") + " (type to search)");
    const ul = document.createElement("ul"); ul.id = id; ul.setAttribute("role", "listbox"); ul.hidden = true;
    box.append(inp, ul);
    sel.before(box); sel.style.display = "none";

    let rows = [], act = -1, open = false;
    const curText = () => { const o = sel.options[sel.selectedIndex]; return o ? o.text : ""; };
    const sync = () => { if (!open) inp.value = curText(); inp.title = curText(); inp.disabled = sel.disabled; };

    function render(q) {
      const toks = norm(q).split(" ").filter(Boolean);
      ul.innerHTML = ""; rows = []; act = -1;
      let n = 0, lastG = null;
      for (const o of sel.options) {
        if (o.disabled) continue;
        const g = o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : "";
        const hay = norm(o.text + " " + g);
        if (toks.length && !toks.every((t) => hay.includes(" " + t))) continue;
        if (++n > MAX_ROWS) break;
        if (g && g !== lastG) { const h = document.createElement("li"); h.className = "g"; h.textContent = g; h.setAttribute("role", "presentation"); ul.appendChild(h); }
        lastG = g;
        const li = document.createElement("li");
        li.textContent = o.text; li.id = id + "-" + rows.length; li.setAttribute("role", "option");
        if (o.value === sel.value) li.classList.add("cur");
        li.dataset.i = rows.length; rows.push(o); ul.appendChild(li);
      }
      if (!rows.length) { const e = document.createElement("li"); e.className = "e"; e.textContent = "No match"; ul.appendChild(e); }
      else if (n > MAX_ROWS) { const e = document.createElement("li"); e.className = "e"; e.textContent = "Keep typing to narrow the list…"; ul.appendChild(e); }
      if (toks.length && rows.length) hi(0);
      else { const c = rows.findIndex((o) => o.value === sel.value); if (c >= 0) { const li = ul.children[[...ul.children].findIndex((x) => x.dataset.i == c)]; if (li) ul.scrollTop = li.offsetTop - 40; } }
    }
    function hi(i) {
      const prev = ul.querySelector("[aria-selected=true]"); if (prev) prev.removeAttribute("aria-selected");
      act = i; if (i < 0) { inp.removeAttribute("aria-activedescendant"); return; }
      const li = document.getElementById(id + "-" + i); if (!li) return;
      li.setAttribute("aria-selected", "true"); inp.setAttribute("aria-activedescendant", li.id);
      const t = li.offsetTop, b = t + li.offsetHeight;
      if (t < ul.scrollTop) ul.scrollTop = t - 24; else if (b > ul.scrollTop + ul.clientHeight) ul.scrollTop = b - ul.clientHeight;
    }
    function show() { if (open || sel.disabled) return; open = true; inp.value = ""; render(""); ul.hidden = false; inp.setAttribute("aria-expanded", "true"); }
    function hide() { if (!open) return; open = false; ul.hidden = true; inp.setAttribute("aria-expanded", "false"); hi(-1); sync(); }
    function pick(i) {
      const o = rows[i]; if (!o) return;
      const changed = o.value !== sel.value;
      sel.value = o.value; hide(); inp.blur();
      if (changed) sel.dispatchEvent(new Event("change", { bubbles: true }));
    }

    inp.addEventListener("focus", show);
    inp.addEventListener("click", show);
    inp.addEventListener("input", () => { if (!open) show(); render(inp.value); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!open) show(); else hi(Math.min(act + 1, rows.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); hi(Math.max(act - 1, 0)); }
      else if (e.key === "Enter") { if (open) { e.preventDefault(); pick(act >= 0 ? act : 0); } }
      else if (e.key === "Escape") { if (open) { e.preventDefault(); hide(); } }
      else if (e.key === "Tab") hide();
    });
    // pointerdown + preventDefault keeps focus in the box so the tap registers before blur
    ul.addEventListener("pointerdown", (e) => e.preventDefault());
    ul.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const li = e.target.closest("li[role=option]"); if (li) pick(+li.dataset.i); });
    inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) hide(); }, 120));
    // The label around the select would otherwise forward taps to the hidden select
    const lab = sel.closest("label"); if (lab) lab.addEventListener("click", (e) => { if (!box.contains(e.target)) { e.preventDefault(); inp.focus(); } });

    // Page scripts rebuild options (innerHTML), change the value or toggle disabled: keep the box in step
    new MutationObserver(() => { sync(); if (open) render(inp.value); }).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(sel, "value", { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); } });
    const dDis = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "disabled");
    Object.defineProperty(sel, "disabled", { configurable: true, get() { return dDis.get.call(this); }, set(v) { dDis.set.call(this, v); sync(); } });
    sel.addEventListener("change", sync);
    sync();
  }

  const scan = (root) => { (root.matches && root.matches("select") ? [root] : []).concat([...(root.querySelectorAll ? root.querySelectorAll("select") : [])]).forEach(enhance); };
  const start = () => {
    scan(document);
    // New selects added by page scripts, and selects that start empty and are filled later
    new MutationObserver((ms) => {
      for (const m of ms) {
        const s = m.target.closest && m.target.closest("select"); if (s) { enhance(s); continue; }
        for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
