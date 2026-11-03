/* Outside spending in the Texas Senate general election: pro-Talarico vs. pro-Paxton + top spenders.
 * Reads outside.json (written by scripts/fec_senate.py) from the same folder. No libraries needed.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "outside.json",
    version: "3",                          // bump after re-running fec_senate.py
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

    const max = Math.max(...data.sides.map(s => s.total), 1);
    $("#bars").innerHTML = data.sides.map(s => {
      const c = css(`--s-${s.key}`), c2 = css(`--s-${s.key}-2`);
      const segs = s.segments.filter(x => x.total > 0);
      return `<div class="bar-row" style="--c:${c};--c2:${c2}">
        <div class="bar-head"><b>${s.label}</b><span>${money(s.total)}</span></div>
        <div class="track" role="img" aria-label="${s.label}: ${money(s.total)}, ${segs.map(x => `${x.label} ${money(x.total)}`).join(", ")}">
          ${segs.map(x => `<div class="seg-bar ${x.kind}" style="width:${(100 * x.total / max).toFixed(2)}%"></div>`).join("")}
        </div>
        <div class="bar-sub">${s.segments.map(x =>
          `<span><i style="background:${x.kind === "support" ? c : c2}"></i>${x.label}: ${money(x.total)}</span>`).join("")}</div>
      </div>`;
    }).join("");

    $("#top").innerHTML = data.sides.map(s => `
      <div style="--c:${css(`--s-${s.key}`)}">
        <h2>Biggest ${s.label.replace(/^Pro-/, "pro-")} spenders</h2>
        <ol>${s.top.map(g => `<li><span>${esc(g.name)}</span><span>${money(g.total)}</span></li>`).join("")}</ol>
        ${s.n_groups > s.top.length ? `<div class="more">${s.n_groups - s.top.length} more groups not shown</div>` : ""}
      </div>`).join("");

    const latest = data.sides.map(s => s.latest).filter(Boolean).sort().pop();
    $("#notes").innerHTML = `<p><b>Notes.</b> ${data.notes.join(" ")}</p>` +
      `<p>Source: <a href="${data.source.url}" target="_blank" rel="noopener">${data.source.label}</a>, independent expenditures` +
      `${latest ? ` through ${date(latest)}` : ""}, retrieved ${date(data.pulled)}.</p>`;

    new ResizeObserver(postHeight).observe($("#app"));
    postHeight();
  }

  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
