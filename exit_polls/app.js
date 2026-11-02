/* Texas presidential exit polls by race/ethnicity: interactive line chart.
 * Reads exit_polls.json (written by scripts/exit_polls.py) from the same folder.
 * A null value breaks the line; it picks up again at the next cycle with data.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "exit_polls.json",
    version: "1",                          // bump after re-running exit_polls.py
    heightMessage: "site-data:height",     // postMessage type for auto-sizing the WordPress iframe
  };

  const MEASURES = {
    dem:    { label: "Democratic share", axis: d => `${d}%` },
    gop:    { label: "Republican share", axis: d => `${d}%` },
    margin: { label: "Margin",           axis: d => fmtMargin(d, 0) },
  };

  const state = { measure: "dem", hidden: new Set(), year: null };
  let data, series, years;

  const $ = s => document.querySelector(s);
  const fmt1 = d3.format(".1f");
  const color = key => getComputedStyle(document.documentElement).getPropertyValue(`--s-${key}`).trim();
  const valueOf = p => p[state.measure];
  function fmtMargin(v, digits = 1) {
    if (v == null) return "No data";
    const n = digits ? fmt1(Math.abs(v)) : Math.abs(v);
    return v === 0 ? "Even" : v > 0 ? `D+${n}` : `R+${n}`;
  }
  const fmtVal = p => p == null || p.dem == null ? "No data"
    : state.measure === "margin" ? fmtMargin(p.margin) : `${fmt1(valueOf(p))}%`;

  async function init() {
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        Check that exit_polls.json sits next to index.html and the page is served over http(s).</div>`;
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
    postHeight();
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
    const m = { top: 16, right: narrow ? 16 : 24, bottom: 32, left: narrow ? 46 : 56 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();

    const visible = series.filter(s => !state.hidden.has(s.key));
    const isMargin = state.measure === "margin";

    // shares: fixed 0-100 so Dem and GOP views compare directly; margin: symmetric around even
    let yDomain = [0, 100];
    if (isMargin) {
      const maxAbs = d3.max(visible.flatMap(s => s.values.map(p => Math.abs(p.margin ?? 0)))) || 10;
      const lim = Math.ceil(maxAbs / 20) * 20;
      yDomain = [-lim, lim];
    }

    const pad = narrow ? 14 : 24;   // keep end dots off the plot edges
    const x = d3.scaleLinear().domain(d3.extent(years)).range([pad, iw - pad]);
    const y = d3.scaleLinear().domain(yDomain).range([ih, 0]);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const ticks = isMargin ? d3.range(yDomain[0], yDomain[1] + 1, yDomain[1] > 40 ? (narrow ? 40 : 20) : 10)
      : narrow ? [0, 25, 50, 75, 100] : [0, 20, 40, 60, 80, 100];

    // gridlines and axes
    g.append("g").attr("class", "grid")
      .call(d3.axisLeft(y).tickValues(ticks).tickSize(-iw).tickFormat(""));
    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).tickValues(ticks).tickFormat(MEASURES[state.measure].axis))
      .call(a => a.select(".domain").remove())
      .call(a => a.selectAll("line").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickValues(years).tickFormat(d3.format("d")).tickSizeOuter(0))
      .call(a => a.select(".domain").attr("d", `M0,0H${iw}`));

    // reference line: 50% for shares, even for margin
    const ref = isMargin ? 0 : 50;
    g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", iw).attr("y1", y(ref)).attr("y2", y(ref));

    // lines (broken at nulls) and points
    const line = d3.line().defined(p => valueOf(p) != null).x(p => x(p.year)).y(p => y(valueOf(p)));
    for (const s of visible) {
      g.append("path").attr("class", "line").attr("stroke", color(s.key)).attr("d", line(s.values));
      g.selectAll(null).data(s.values.filter(p => valueOf(p) != null)).join("circle")
        .attr("class", "dot").attr("r", 4.5).attr("fill", color(s.key))
        .attr("cx", p => x(p.year)).attr("cy", p => y(valueOf(p)));
    }

    // hover layer: snaps to the nearest cycle
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
      const i = state.year == null ? (ev.key === "ArrowRight" ? -1 : years.length) : years.indexOf(state.year);
      show(years[Math.max(0, Math.min(years.length - 1, i + (ev.key === "ArrowRight" ? 1 : -1)))]);
    };
    svgEl.onblur = hide;
    if (state.year != null) show(state.year);
  }

  function renderTip(yr, px, width) {
    const rows = series
      .filter(s => !state.hidden.has(s.key))
      .map(s => ({ s, p: s.values.find(v => v.year === yr) }))
      .sort((a, b) => (valueOf(b.p) ?? -Infinity) - (valueOf(a.p) ?? -Infinity));
    const tip = $("#tip");
    tip.innerHTML = `<h3>${yr} · ${MEASURES[state.measure].label}</h3>` + rows.map(({ s, p }) => {
      const na = p == null || p.dem == null;
      return `<div class="row"><span class="sw" style="background:${color(s.key)}"></span>` +
        `<span class="name">${s.label}</span><span class="val${na ? " na" : ""}">${fmtVal(p)}</span></div>`;
    }).join("");
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > width ? px - 14 - tw : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `8px`;
  }

  // ---------------------------------------------------------------- table, notes
  function buildTable() {
    const t = $("#srTable");
    t.innerHTML = `<caption>Texas presidential exit polls by race and ethnicity, ${years[0]}–${years[years.length - 1]}</caption>` +
      `<thead><tr><th>Group</th>${years.map(y => `<th>${y}</th>`).join("")}</tr></thead><tbody>` +
      series.map(s => `<tr><th>${s.label}</th>${s.values.map(p =>
        `<td>${p.dem == null ? "no data" : `Democratic ${fmt1(p.dem)}%, Republican ${fmt1(p.gop)}%`}</td>`).join("")}</tr>`).join("") +
      `</tbody>`;
  }

  function buildNotes() {
    const src = data.source;
    $("#notes").innerHTML =
      `<p><b>Notes.</b> ${data.notes.join(" ")}</p>` +
      `<p>Source: <a href="${src.url}" target="_blank" rel="noopener">${src.label}</a>.</p>`;
  }

  // ---------------------------------------------------------------- iframe sizing
  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
