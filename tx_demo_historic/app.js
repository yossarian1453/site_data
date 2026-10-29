/* Texas population by race, 1980-2020: interactive line chart.
 * Reads race.json (written by scripts/census_race.py) from the same folder.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "race.json",
    version: "1",                          // bump after re-running census_race.py
    heightMessage: "site-data:height",     // postMessage type for auto-sizing the WordPress iframe
    // vertical markers for changes in how race was asked or coded
    breaks: [
      { year: 2000, label: "Two or more races first allowed" },
    ],
  };

  const state = { measure: "share", hidden: new Set(), year: null };
  let data, series, years;

  const $ = s => document.querySelector(s);
  const fmtShare = d3.format(".1f");
  const fmtCount = d3.format(",");
  const fmtAxisCount = d3.format("~s");
  const color = key => getComputedStyle(document.documentElement).getPropertyValue(`--s-${key}`).trim();
  const valueOf = (pt) => state.measure === "share" ? pt.share : pt.count;
  const fmtVal = (pt) => pt.count == null ? "—"
    : state.measure === "share" ? `${fmtShare(pt.share)}%` : fmtCount(pt.count);

  async function init() {
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        Check that race.json sits next to index.html and the page is served over http(s).</div>`;
      postHeight();
      return;
    }
    series = data.series;
    years = data.years;

    buildControls();
    buildLegend();
    buildTable();
    buildNotes();
    draw();

    // redraw only when the width actually changes (redrawing under the pointer would close the tooltip)
    let lastWidth = $("#chart").clientWidth;
    new ResizeObserver(() => {
      const w = $("#chart").clientWidth;
      if (w !== lastWidth) { lastWidth = w; draw(); }
      postHeight();
    }).observe($("#chart"));
  }

  // ---------------------------------------------------------------- controls
  function buildControls() {
    document.querySelectorAll("[data-measure]").forEach(b => b.addEventListener("click", () => {
      state.measure = b.dataset.measure;
      document.querySelectorAll("[data-measure]").forEach(x =>
        x.setAttribute("aria-pressed", String(x.dataset.measure === state.measure)));
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
    const height = narrow ? 340 : 420;
    const m = { top: 28, right: narrow ? 16 : 24, bottom: 32, left: narrow ? 44 : 56 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();

    const visible = series.filter(s => !state.hidden.has(s.key));
    const maxVal = d3.max(visible.flatMap(s => s.values.map(valueOf).filter(v => v != null))) || 1;

    const x = d3.scaleLinear().domain(d3.extent(years)).range([0, iw]);
    const y = d3.scaleLinear().domain([0, maxVal]).nice().range([ih, 0]);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    // gridlines and axes
    g.append("g").attr("class", "grid")
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 6).tickSize(-iw).tickFormat(""));
    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 6)
        .tickFormat(state.measure === "share" ? d => `${d}%` : d => fmtAxisCount(d).replace("k", "K")))
      .call(a => a.select(".domain").remove())
      .call(a => a.selectAll("line").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickValues(years).tickFormat(d3.format("d")));

    // markers for comparability breaks
    for (const b of CONFIG.breaks) {
      if (b.year < years[0] || b.year > years[years.length - 1]) continue;
      const bx = x(b.year);
      const gb = g.append("g").attr("class", "break");
      gb.append("line").attr("x1", bx).attr("x2", bx).attr("y1", -8).attr("y2", ih);
      if (!narrow) gb.append("text").attr("x", bx).attr("y", -14)
        .attr("text-anchor", b.year === years[years.length - 1] ? "end" : "middle").text(b.label);
    }

    // lines and points
    const line = d3.line().defined(p => valueOf(p) != null).x(p => x(p.year)).y(p => y(valueOf(p)));
    for (const s of visible) {
      g.append("path").attr("class", "line").attr("stroke", color(s.key)).attr("d", line(s.values));
      g.selectAll(null).data(s.values.filter(p => valueOf(p) != null)).join("circle")
        .attr("class", "dot").attr("r", 4.5).attr("fill", color(s.key))
        .attr("cx", p => x(p.year)).attr("cy", p => y(valueOf(p)));
    }

    // hover layer: snaps to the nearest census year
    const guide = g.append("line").attr("class", "guide").attr("y1", 0).attr("y2", ih).style("display", "none");
    const show = yr => {
      state.year = yr;
      guide.style("display", null).attr("x1", x(yr)).attr("x2", x(yr));
      renderTip(yr, m.left + x(yr), width);
    };
    const hide = () => { state.year = null; guide.style("display", "none"); $("#tip").style.display = "none"; };
    const nearest = px => years.reduce((a, b) => Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a);

    g.append("rect").attr("class", "hit").attr("x", -8).attr("y", -8).attr("width", iw + 16).attr("height", ih + 16)
      .on("pointermove pointerdown", ev => show(nearest(d3.pointer(ev)[0])))
      .on("pointerleave", ev => { if (ev.pointerType !== "touch") hide(); });

    const svgEl = $("#svg");
    svgEl.onkeydown = ev => {
      if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      ev.preventDefault();
      const i = state.year == null ? (ev.key === "ArrowRight" ? -1 : years.length)
        : years.indexOf(state.year);
      show(years[Math.max(0, Math.min(years.length - 1, i + (ev.key === "ArrowRight" ? 1 : -1)))]);
    };
    svgEl.onblur = hide;
    if (state.year != null) show(state.year);
  }

  function renderTip(yr, px, width) {
    const rows = series
      .filter(s => !state.hidden.has(s.key))
      .map(s => ({ s, p: s.values.find(v => v.year === yr) }))
      .sort((a, b) => (valueOf(b.p) ?? -1) - (valueOf(a.p) ?? -1));
    const tip = $("#tip");
    tip.innerHTML = `<h3>${yr}</h3>` + rows.map(({ s, p }) =>
      `<div class="row"><span class="sw" style="background:${color(s.key)}"></span>` +
      `<span class="name">${s.label}</span><span class="val">${fmtVal(p)}</span></div>`).join("") +
      `<div class="total"><span>Total population</span><b>${fmtCount(data.total[String(yr)])}</b></div>`;
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > width ? px - 14 - tw : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `8px`;
  }

  // ---------------------------------------------------------------- table, notes
  function buildTable() {
    const t = $("#srTable");
    t.innerHTML = `<caption>Texas population by race, ${years[0]}–${years[years.length - 1]}</caption>` +
      `<thead><tr><th>Group</th>${years.map(y => `<th>${y}</th>`).join("")}</tr></thead><tbody>` +
      series.map(s => `<tr><th>${s.label}</th>${s.values.map(p =>
        `<td>${p.count == null ? "not counted" : `${fmtCount(p.count)} (${fmtShare(p.share)}%)`}</td>`).join("")}</tr>`).join("") +
      `<tr><th>Total</th>${years.map(y => `<td>${fmtCount(data.total[String(y)])}</td>`).join("")}</tr></tbody>`;
  }

  function buildNotes() {
    $("#notes").innerHTML =
      `<p><b>Notes.</b> ${data.notes.join(" ")}</p>` +
      `<p>Sources: ${data.sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>`).join("; ")}.</p>`;
  }

  // ---------------------------------------------------------------- iframe sizing
  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
