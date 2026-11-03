/* Talarico vs. Paxton campaign fundraising: summary cards + line chart over time.
 * Reads fundraising.json (written by scripts/fec_senate.py) from the same folder.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "fundraising.json",
    version: "1",                          // bump after re-running fec_senate.py
    heightMessage: "site-data:height",
  };
  const LABELS = { raised: "Total raised", spent: "Total spent", cash: "Cash on hand" };

  const state = { measure: "raised", date: null };
  let data, cands;

  const $ = s => document.querySelector(s);
  const parse = d3.utcParse("%Y-%m-%d");
  const fmtDate = d3.utcFormat("%b. %-d, %Y");
  const money = n => n == null ? "—" : n >= 1e6 ? `$${d3.format(".1f")(n / 1e6)}M` : `$${d3.format(",")(Math.round(n / 1000))}K`;
  const moneyAxis = n => n === 0 ? "$0" : `$${d3.format("~s")(n).replace("G", "B")}`;
  const color = k => getComputedStyle(document.documentElement).getPropertyValue(`--s-${k}`).trim();

  async function init() {
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        Check that fundraising.json sits next to index.html and the page is served over http(s).</div>`;
      postHeight();
      return;
    }
    cands = data.candidates.map(c => ({ ...c, pts: c.series.map(p => ({ ...p, d: parse(p.date) })) }));

    buildCards();
    document.querySelectorAll("[data-measure]").forEach(b => b.addEventListener("click", () => {
      state.measure = b.dataset.measure;
      document.querySelectorAll("[data-measure]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.measure === state.measure)));
      draw();
    }));
    buildTable();
    buildNotes();
    draw();

    let lastWidth = $("#chart").clientWidth;
    new ResizeObserver(() => {
      const w = $("#chart").clientWidth;
      if (w !== lastWidth) { lastWidth = w; draw(); }
      postHeight();
    }).observe($("#app"));
    postHeight();
  }

  function buildCards() {
    $("#cards").innerHTML = cands.map(c => `
      <div class="card" style="--c:${color(c.key)}">
        <h2>${c.name}</h2>
        <dl><dt>Raised</dt><dd>${money(c.totals.raised)}</dd>
            <dt>Spent</dt><dd>${money(c.totals.spent)}</dd>
            <dt>Cash on hand</dt><dd>${money(c.totals.cash)}</dd></dl>
        <div class="asof">Through ${fmtDate(parse(c.totals.through))}</div>
      </div>`).join("");
  }

  // value of a candidate's series as of a date (the last report on or before it)
  const asOf = (c, d) => { let v = null; for (const p of c.pts) if (p.d <= d) v = p; return v; };

  function draw() {
    const svg = d3.select("#svg");
    const width = $("#chart").clientWidth || 800;
    const narrow = width < 560;
    const height = narrow ? 300 : 360;
    const m = { top: 14, right: narrow ? 14 : 84, bottom: 30, left: narrow ? 46 : 56 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();

    const key = state.measure;
    const all = cands.flatMap(c => c.pts.filter(p => p[key] != null));
    const x = d3.scaleUtc().domain(d3.extent(all, p => p.d)).range([0, iw]);
    const y = d3.scaleLinear().domain([0, d3.max(all, p => p[key]) || 1]).nice(5).range([ih, 0]);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(moneyAxis))
      .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(narrow ? 4 : 8).tickFormat(d3.utcFormat("%b '%y")).tickSizeOuter(0));

    // cash on hand jumps report to report, so it steps; running totals are drawn as lines
    const curve = key === "cash" ? d3.curveStepAfter : d3.curveLinear;
    const line = d3.line().defined(p => p[key] != null).curve(curve).x(p => x(p.d)).y(p => y(p[key]));
    for (const c of cands) {
      const pts = c.pts.filter(p => p[key] != null);
      g.append("path").attr("class", "line").attr("stroke", color(c.key)).attr("stroke-width", 2.5).attr("d", line(pts));
      g.selectAll(null).data(pts.filter(p => p.report !== "start")).join("circle").attr("class", "dot")
        .attr("r", 3.5).attr("fill", color(c.key)).attr("cx", p => x(p.d)).attr("cy", p => y(p[key]));
    }

    // end labels with the latest value (wide screens; the cards cover narrow ones)
    if (!narrow) {
      const ends = cands.map(c => { const p = c.pts.filter(q => q[key] != null).at(-1); return { c, p, y: y(p[key]) }; })
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 30);
      for (const { c, p, y: yy } of ends) {
        const t = g.append("text").attr("class", "end-lbl").attr("fill", color(c.key)).attr("x", x(p.d) + 10).attr("y", yy);
        t.append("tspan").attr("x", x(p.d) + 10).attr("dy", "-0.1em").text(c.name);
        t.append("tspan").attr("x", x(p.d) + 10).attr("dy", "1.2em").attr("font-weight", 700).text(money(p[key]));
      }
    }

    // hover: snap to the nearest report date from either campaign
    const dates = [...new Set(all.filter(p => p.report !== "start").map(p => +p.d))].sort((a, b) => a - b).map(t => new Date(t));
    const guide = g.append("line").attr("class", "guide").attr("y1", 0).attr("y2", ih).style("display", "none").lower();
    const show = d => {
      state.date = d;
      guide.style("display", null).attr("x1", x(d)).attr("x2", x(d));
      renderTip(d, m.left + x(d), width);
    };
    const hide = () => { state.date = null; guide.style("display", "none"); $("#tip").style.display = "none"; };
    const nearest = px => dates.reduce((a, b) => Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a);

    g.append("rect").attr("class", "hit").attr("x", -8).attr("y", -8).attr("width", iw + 16).attr("height", ih + 16)
      .on("pointermove pointerdown", ev => show(nearest(d3.pointer(ev)[0])))
      .on("pointerleave", ev => { if (ev.pointerType !== "touch") hide(); });

    const svgEl = $("#svg");
    svgEl.onkeydown = ev => {
      if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      ev.preventDefault();
      const i = state.date == null ? (ev.key === "ArrowRight" ? -1 : dates.length) : dates.findIndex(d => +d === +state.date);
      show(dates[Math.max(0, Math.min(dates.length - 1, i + (ev.key === "ArrowRight" ? 1 : -1)))]);
    };
    svgEl.onblur = hide;
    if (state.date != null) show(state.date);
  }

  function renderTip(d, px, width) {
    const key = state.measure;
    const tip = $("#tip");
    tip.innerHTML = `<h3>${LABELS[key]}, ${fmtDate(d)}</h3>` + cands.map(c => {
      const p = asOf(c, d);
      return `<div class="row"><span class="sw" style="background:${color(c.key)}"></span>` +
        `<span class="name">${c.name}</span><span class="val">${money(p ? p[key] : null)}</span></div>`;
    }).join("");
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > width ? px - 14 - tw : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `8px`;
  }

  function buildTable() {
    $("#srTable").innerHTML = `<caption>Campaign fundraising by report, ${data.race}</caption>` +
      `<thead><tr><th>Candidate</th><th>Report ending</th><th>Raised to date</th><th>Spent to date</th><th>Cash on hand</th></tr></thead><tbody>` +
      cands.flatMap(c => c.pts.filter(p => p.report !== "start").map(p =>
        `<tr><td>${c.name}</td><td>${fmtDate(p.d)}</td><td>${money(p.raised)}</td><td>${money(p.spent)}</td><td>${money(p.cash)}</td></tr>`)).join("") +
      `</tbody>`;
  }

  function buildNotes() {
    $("#notes").innerHTML = `<p><b>Notes.</b> ${data.notes.join(" ")}</p>` +
      `<p>Source: <a href="${data.source.url}" target="_blank" rel="noopener">${data.source.label}</a>, retrieved ${fmtDate(parse(data.pulled))}.</p>`;
  }

  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
