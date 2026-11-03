/* Super PAC money in the Texas Senate race: pro-Talarico vs. pro-Paxton money raised.
 * Reads outside.json (written by scripts/fec_senate.py) from the same folder. No libraries needed.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "outside.json",
    version: "2",                          // bump after re-running fec_senate.py
    heightMessage: "site-data:height",
  };

  const $ = s => document.querySelector(s);
  const money = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000).toLocaleString("en-US")}K`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const date = iso => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  async function init() {
    let data;
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        Check that outside.json sits next to index.html and the page is served over http(s).</div>`;
      postHeight();
      return;
    }

    const max = Math.max(...data.sides.map(s => s.raised), 1);
    $("#bars").innerHTML = data.sides.map(s => {
      const c = css(`--s-${s.key}`);
      return `<div class="bar-row" style="--c:${c}">
        <div class="bar-head"><b>${s.label} super PACs</b><span>${money(s.raised)}</span></div>
        <div class="track" role="img" aria-label="${s.label} super PACs raised ${money(s.raised)}">
          <div class="seg-bar support" style="width:${(100 * s.raised / max).toFixed(2)}%"></div>
        </div>
      </div>`;
    }).join("");

    $("#top").innerHTML = data.sides.map(s => `
      <div style="--c:${css(`--s-${s.key}`)}">
        <h2>Backing ${esc(s.candidate)}</h2>
        <ol>${s.groups.map(g => `<li><span>${esc(g.name)}<span class="thru"> · through ${date(g.through)}</span></span>` +
          `<span>${money(g.raised)}</span></li>`).join("")}</ol>
      </div>`).join("");

    $("#notes").innerHTML = `<p><b>Notes.</b> ${data.notes.join(" ")}</p>` +
      `<p>Source: <a href="${data.source.url}" target="_blank" rel="noopener">${data.source.label}</a>, retrieved ${date(data.pulled)}.</p>`;

    new ResizeObserver(postHeight).observe($("#app"));
    postHeight();
  }

  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
