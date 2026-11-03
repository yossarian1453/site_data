/* What the 2026 polls imply in Latino votes: a simple table with a poll selector.
 * Reads projection.json (written by scripts/latino_projection.py) from the same folder.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "projection.json",
    version: "1",                          // bump after re-running latino_projection.py
    heightMessage: "site-data:height",
    keyScenario: "average",                // the row to emphasize (matched by text)
  };

  const $ = s => document.querySelector(s);
  const k = n => `${Math.round(n / 1000).toLocaleString("en-US")},000`;          // 399,148 -> "399,000"
  const m = n => `${(n / 1e6).toFixed(2)} million`;
  let data, pollKey;

  async function init() {
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        Check that projection.json sits next to index.html and the page is served over http(s).</div>`;
      postHeight();
      return;
    }
    pollKey = data.polls[0].key;
    if (data.polls.length > 1) buildSelector(); else $(".controls").remove();
    render();
    buildNotes();
    new ResizeObserver(postHeight).observe($("#app"));
    postHeight();
  }

  function buildSelector() {
    const box = $("#polls");
    for (const p of data.polls) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.poll = p.key;
      b.textContent = `${p.label.split(",")[0]} (${p.dem.name.split(" ").pop()} +${p.dem.pct - p.rep.pct})`;
      b.setAttribute("aria-pressed", String(p.key === pollKey));
      b.addEventListener("click", () => {
        pollKey = p.key;
        box.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.poll === pollKey)));
        render();
      });
      box.append(b);
    }
  }

  const net = (n, dName, rName) => n >= 0
    ? `<span class="net-d">${dName} <b>+${k(n)}</b></span>`
    : `<span class="net-r">${rName} <b>+${k(-n)}</b></span>`;

  function render() {
    const p = data.polls.find(x => x.key === pollKey);
    const b = data.pres2024;
    $("#table").innerHTML =
      `<caption>${p.label}: ${p.dem.name} ${p.dem.pct}%, ${p.rep.name} ${p.rep.pct}% among ${p.population || "Latino voters"}` +
      `${p.n ? ` (n = ${p.n.toLocaleString("en-US")}${p.moe ? `, ±${p.moe} points` : ""})` : ""}. ` +
      `Based on ${m(data.registered_base)} Latino registered voters (${data.base_year}).</caption>` +
      `<thead><tr><th scope="col">Scenario</th><th scope="col">Turnout of registered</th><th scope="col">Latino voters</th>` +
      `<th scope="col" class="cand">Democrat</th><th scope="col" class="cand">Republican</th>` +
      `<th scope="col">Net votes</th><th scope="col" class="chg">Change from 2024</th></tr></thead><tbody>` +
      `<tr class="base sep"><th scope="row">2024 presidential<span class="sub">${b.rep.name} ${b.rep.pct}–${b.dem.pct}, exit poll</span></th>` +
      `<td>${b.turnout.toFixed(1)}%</td><td>${m(b.voters)}</td>` +
      `<td class="cand">${b.dem.name} ${k(b.dem.votes)}</td><td class="cand">${b.rep.name} ${k(b.rep.votes)}</td>` +
      `<td>${net(b.net, b.dem.name, b.rep.name)}</td><td class="chg">—</td></tr>` +
      p.rows.map(r => `<tr class="${r.scenario.includes(CONFIG.keyScenario) ? "key" : ""}">` +
        `<th scope="row">2026 at ${r.scenario}</th><td>${r.turnout.toFixed(1)}%</td><td>${m(r.voters)}</td>` +
        `<td class="cand">${p.dem.name} ${k(r.dem)}</td><td class="cand">${p.rep.name} ${k(r.rep)}</td>` +
        `<td>${net(r.net, p.dem.name, p.rep.name)}</td>` +
        `<td class="chg">${r.swing >= 0 ? "D" : "R"} +${k(Math.abs(r.swing))}</td></tr>`).join("") +
      `</tbody>`;
    postHeight();
  }

  function buildNotes() {
    const polls = data.polls.map(p => `<a href="${p.url}" target="_blank" rel="noopener">${p.label}</a>`).join("; ");
    $("#notes").innerHTML =
      `<p><b>Notes.</b> ${data.notes.join(" ")}</p>` +
      `<p>Sources: <a href="${data.source.url}" target="_blank" rel="noopener">${data.source.label}</a> (registration and turnout); ` +
      `Edison Research exit poll (2024); ${polls}.</p>`;
  }

  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
