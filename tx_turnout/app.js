/* Texas turnout by race/ethnicity, 2012-2024: line chart with a presidential/midterm toggle.
 * Reads turnout.json (written by scripts/turnout.py) from the same folder.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "turnout.json",
    version: "1",                          // bump after re-running turnout.py
    heightMessage: "site-data:height",     // postMessage type for auto-sizing the WordPress iframe
    labeled: ["hisp", "white"],            // groups that get a % label on every point
  };

  const state = { type: "pres", hidden: new Set(), year: null };
  let data, series;

  const $ = s => document.querySelector(s);
  const fmt1 = d3.format(".1f");
  const fmtPeople = n => `${d3.format(".1f")(n / 1e6)} million`;
  const color = key => getComputedStyle(document.documentElement).getPropertyValue(`--s-${key}`).trim();
  const years = () => data.years.filter(y => data.presidential.includes(y) === (state.type === "pres"));
  const point = (s, y) => s.values.find(v => v.year === y);

  async function init() {
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        Check that turnout.json sits next to index.html and the page is served over http(s).</div>`;
      postHeight();
      return;
    }
    series = data.series;

    buildControls();
    buildLegend();
    buildTable();
    buildNotes();
    draw();

    let lastWidth = $("#chart").clientWidth;
    new ResizeObserver(() => {
      const w = $("#chart").clientWidth;
      if (w !== lastWidth) { lastWidth = w; draw(); }
      postHeight();
    }).observe($("#chart"));
    postHeight();
  }

  function buildControls() {
    document.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => {
      state.type = b.dataset.type;
      state.year = null;
      $("#tip").style.display = "none";
      document.querySelectorAll("[data-type]").forEach(x =>
        x.setAttribute("aria-pressed", String(x.dataset.type === state.type)));
      draw();
    }));
  }

  function buildLegend() {
    const ul = $("#legend");
    ul.innerHTML = "";
    for (const s of series) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", "true");
      b.innerHTML = `<span class="sw" style="background:${color(s.key)}"></span>${s.label}`;
      b.addEventListener("click", () => {
        const on = state.hidden.has(s.key);
        if (on) state.hidden.delete(s.key); else state.hidden.add(s.key);
        b.setAttribute("aria-pressed", String(on));
        draw();
      });
      li.append(b);
      ul.append(li);
    }
  }

  // ---------------------------------------------------------------- chart
  function draw() {
    const svg = d3.select("#svg");
    const width = $("#chart").clientWidth || 800;
    const narrow = width < 560;
    const height = narrow ? 340 : 400;
    const m = { top: 18, right: narrow ? 14 : 112, bottom: 34, left: narrow ? 40 : 50 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();

    const ys = years();
    const visible = series.filter(s => !state.hidden.has(s.key));
    const x = d3.scalePoint().domain(ys).range([0, iw]).padding(narrow ? 0.35 : 0.25);
    const y = d3.scaleLinear().domain([0, 100]).range([ih, 0]);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const ticks = [0, 20, 40, 60, 80, 100];

    g.append("g").attr("class", "grid").call(d3.axisLeft(y).tickValues(ticks).tickSize(-iw).tickFormat(""));
    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).tickValues(ticks).tickFormat(d => `${d}%`))
      .call(a => a.select(".domain").remove())
      .call(a => a.selectAll("line").remove());
    g.append("g").attr("class", "axis x").attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(10).tickFormat(d3.format("d")))
      .call(a => a.select(".domain").remove());

    // lines and dots; muted groups first so the labeled ones sit on top
    const order = [...visible].sort((a, b) => CONFIG.labeled.includes(a.key) - CONFIG.labeled.includes(b.key));
    const line = d3.line().defined(v => v.turnout != null).x(v => x(v.year)).y(v => y(v.turnout));
    for (const s of order) {
      const vals = ys.map(yr => point(s, yr)).filter(Boolean);
      const big = CONFIG.labeled.includes(s.key);
      g.append("path").attr("class", "line").attr("stroke", color(s.key)).attr("stroke-width", big ? 2.5 : 2).attr("d", line(vals));
      g.selectAll(null).data(vals.filter(v => v.turnout != null)).join("circle")
        .attr("class", "dot").attr("r", big ? 5 : 4).attr("fill", color(s.key))
        .attr("cx", v => x(v.year)).attr("cy", v => y(v.turnout));
    }

    // % labels above each dot, unless another line runs through that spot; then below
    const ROOM = 30;
    for (const yr of ys) {
      const others = visible.map(s => point(s, yr)).filter(v => v && v.turnout != null).map(v => y(v.turnout));
      for (const s of visible.filter(s => CONFIG.labeled.includes(s.key))) {
        const v = point(s, yr);
        if (!v || v.turnout == null) continue;
        const py = y(v.turnout);
        const blocked = dir => others.some(o => o !== py && (dir < 0 ? o < py && py - o < ROOM : o > py && o - py < ROOM));
        const above = !blocked(-1) || blocked(1);
        g.append("text").attr("class", "lbl").attr("fill", color(s.key)).attr("text-anchor", "middle")
          .attr("x", x(yr)).attr("y", py + (above ? -11 : 20)).text(`${fmt1(v.turnout)}%`);
      }
    }

    // group names at the right end (wide screens only; the legend covers narrow ones)
    if (!narrow) {
      const last = ys[ys.length - 1];
      const ends = visible.map(s => ({ s, y: y(point(s, last).turnout) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);
      for (const { s, y: yy } of ends)
        g.append("text").attr("class", "end-lbl").attr("fill", color(s.key)).attr("x", x(last) + 30).attr("y", yy + 4).text(s.label);
    }

    // hover layer: snaps to the nearest year
    const guide = g.append("line").attr("class", "guide").attr("y1", 0).attr("y2", ih).style("display", "none").lower();
    const show = yr => {
      state.year = yr;
      guide.style("display", null).attr("x1", x(yr)).attr("x2", x(yr));
      renderTip(yr, m.left + x(yr), width);
    };
    const hide = () => { state.year = null; guide.style("display", "none"); $("#tip").style.display = "none"; };
    const nearest = px => ys.reduce((a, b) => Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a);

    g.append("rect").attr("class", "hit").attr("x", -8).attr("y", -8).attr("width", iw + 16).attr("height", ih + 16)
      .on("pointermove pointerdown", ev => show(nearest(d3.pointer(ev)[0])))
      .on("pointerleave", ev => { if (ev.pointerType !== "touch") hide(); });

    const svgEl = $("#svg");
    svgEl.onkeydown = ev => {
      if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      ev.preventDefault();
      const i = state.year == null ? (ev.key === "ArrowRight" ? -1 : ys.length) : ys.indexOf(state.year);
      show(ys[Math.max(0, Math.min(ys.length - 1, i + (ev.key === "ArrowRight" ? 1 : -1)))]);
    };
    svgEl.onblur = hide;
    if (state.year != null && ys.includes(state.year)) show(state.year);
  }

  function renderTip(yr, px, width) {
    const rows = series.filter(s => !state.hidden.has(s.key))
      .map(s => ({ s, v: point(s, yr) })).sort((a, b) => (b.v?.turnout ?? -1) - (a.v?.turnout ?? -1));
    const w = point(series.find(s => s.key === "white"), yr), h = point(series.find(s => s.key === "hisp"), yr);
    const total = data.totals[String(yr)];
    const tip = $("#tip");
    tip.innerHTML = `<h3>${yr} turnout</h3>` + rows.map(({ s, v }) =>
      `<div class="row"><span class="sw" style="background:${color(s.key)}"></span>` +
      `<span class="name">${s.label}</span><span class="val">${v?.turnout == null ? "No data" : `${fmt1(v.turnout)}%`}</span></div>` +
      (v?.turnout == null ? "" : `<div class="row"><span class="sw"></span><span class="name" style="font-size:0.78rem">${fmtPeople(v.voted)} of ${fmtPeople(v.citizens)}</span></div>`)
    ).join("") +
      (w?.turnout != null && h?.turnout != null
        ? `<div class="gap"><span>White–Latino gap</span><b>${fmt1(w.turnout - h.turnout)} pts</b></div>` : "") +
      (total ? `<div class="gap"><span>All Texas citizens</span><b>${fmt1(total.turnout)}%</b></div>` : "");
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > width ? px - 14 - tw : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `8px`;
  }

  // ---------------------------------------------------------------- table, notes
  function buildTable() {
    $("#srTable").innerHTML = `<caption>Turnout among Texas adult citizens by race and ethnicity, ${data.years[0]}–${data.years[data.years.length - 1]}</caption>` +
      `<thead><tr><th>Group</th>${data.years.map(y => `<th>${y}</th>`).join("")}</tr></thead><tbody>` +
      series.map(s => `<tr><th>${s.label}</th>${s.values.map(v =>
        `<td>${v.turnout == null ? "no data" : `${fmt1(v.turnout)}%`}</td>`).join("")}</tr>`).join("") +
      `<tr><th>All citizens</th>${data.years.map(y => `<td>${fmt1(data.totals[String(y)].turnout)}%</td>`).join("")}</tr></tbody>`;
  }

  function buildNotes() {
    const src = data.source;
    $("#notes").innerHTML =
      `<p><b>Notes.</b> ${data.notes.join(" ")}</p>` +
      `<p>Source: <a href="${src.url}" target="_blank" rel="noopener">${src.label}</a>.</p>`;
  }

  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
