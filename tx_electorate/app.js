/* Texas adults -> citizens -> registered -> voted, by race/ethnicity: step chart.
 * Reads electorate.json (written by scripts/electorate.py) from the same folder.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "electorate.json",
    version: "1",                          // bump after re-running electorate.py
    heightMessage: "site-data:height",     // postMessage type for auto-sizing the WordPress iframe
    labeled: ["hisp", "white"],            // groups that get a % label on every point
  };

  const state = { hidden: new Set(), stage: null };
  let data, series, stages;

  const $ = s => document.querySelector(s);
  const fmt1 = d3.format(".1f");
  const fmtPeople = n => n >= 1e6 ? `${d3.format(".1f")(n / 1e6)} million` : `${d3.format(",")(Math.round(n / 1000))},000`;
  const color = key => getComputedStyle(document.documentElement).getPropertyValue(`--s-${key}`).trim();
  const point = (s, stage) => s.values.find(v => v.stage === stage);

  async function init() {
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        Check that electorate.json sits next to index.html and the page is served over http(s).</div>`;
      postHeight();
      return;
    }
    series = data.series;
    stages = data.stages;
    $("#title").textContent = `From adults to voters: who made up the Texas electorate in ${data.year}`;

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

    const visible = series.filter(s => !state.hidden.has(s.key));
    const maxShare = d3.max(series.flatMap(s => s.values.map(v => v.share))) || 50;
    const yMax = Math.min(100, Math.ceil((maxShare + 5) / 10) * 10);

    const x = d3.scalePoint().domain(stages.map(s => s.key)).range([0, iw]).padding(narrow ? 0.35 : 0.25);
    const y = d3.scaleLinear().domain([0, yMax]).range([ih, 0]);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const ticks = d3.range(0, yMax + 1, yMax > 80 ? 20 : 10);

    g.append("g").attr("class", "grid").call(d3.axisLeft(y).tickValues(ticks).tickSize(-iw).tickFormat(""));
    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).tickValues(ticks).tickFormat(d => `${d}%`))
      .call(a => a.select(".domain").remove())
      .call(a => a.selectAll("line").remove());
    const shortLabel = { adults: "Adults", citizens: "Citizens", registered: "Registered", voted: "Voted" };
    g.append("g").attr("class", "axis x").attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(10)
        .tickFormat(k => narrow ? (shortLabel[k] || k) : stages.find(s => s.key === k).label))
      .call(a => a.select(".domain").remove());

    // lines and dots; muted groups first so the labeled ones sit on top
    const order = [...visible].sort((a, b) => CONFIG.labeled.includes(a.key) - CONFIG.labeled.includes(b.key));
    const line = d3.line().x(v => x(v.stage)).y(v => y(v.share));
    for (const s of order) {
      g.append("path").attr("class", "line").attr("stroke", color(s.key))
        .attr("stroke-width", CONFIG.labeled.includes(s.key) ? 2.5 : 2).attr("d", line(s.values));
      g.selectAll(null).data(s.values).join("circle")
        .attr("class", "dot").attr("r", CONFIG.labeled.includes(s.key) ? 5 : 4).attr("fill", color(s.key))
        .attr("cx", v => x(v.stage)).attr("cy", v => y(v.share));
    }

    // % labels sit above each dot, unless another line runs through that spot; then they go below
    const labeled = visible.filter(s => CONFIG.labeled.includes(s.key));
    const ROOM = 38;   // px a label needs above or below its dot
    for (const st of stages) {
      const ys = visible.map(s => y(point(s, st.key).share));
      for (const s of labeled) {
        const py = y(point(s, st.key).share);
        const blocked = dir => ys.some(o => o !== py && (dir < 0 ? o < py && py - o < ROOM : o > py && o - py < ROOM));
        const above = !blocked(-1) || blocked(1);
        g.append("text").attr("class", "lbl").attr("fill", color(s.key)).attr("text-anchor", "middle")
          .attr("x", x(st.key)).attr("y", py + (above ? -11 : 20)).text(`${fmt1(point(s, st.key).share)}%`);
      }
    }

    // group names at the right end, all in one column (wide screens only; the legend covers narrow ones)
    if (!narrow) {
      const last = stages[stages.length - 1].key;
      const ends = visible.map(s => ({ s, y: y(point(s, last).share) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);   // nudge apart
      for (const { s, y: yy } of ends)
        g.append("text").attr("class", "end-lbl").attr("fill", color(s.key))
          .attr("x", x(last) + 30).attr("y", yy + 4).text(s.label);
    }

    // hover layer: snaps to the nearest stage
    const guide = g.append("line").attr("class", "guide").attr("y1", 0).attr("y2", ih).style("display", "none").lower();
    const keys = stages.map(s => s.key);
    const show = k => {
      state.stage = k;
      guide.style("display", null).attr("x1", x(k)).attr("x2", x(k));
      renderTip(k, m.left + x(k), width);
    };
    const hide = () => { state.stage = null; guide.style("display", "none"); $("#tip").style.display = "none"; };
    const nearest = px => keys.reduce((a, b) => Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a);

    g.append("rect").attr("class", "hit").attr("x", -8).attr("y", -8).attr("width", iw + 16).attr("height", ih + 16)
      .on("pointermove pointerdown", ev => show(nearest(d3.pointer(ev)[0])))
      .on("pointerleave", ev => { if (ev.pointerType !== "touch") hide(); });

    const svgEl = $("#svg");
    svgEl.onkeydown = ev => {
      if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      ev.preventDefault();
      const i = state.stage == null ? (ev.key === "ArrowRight" ? -1 : keys.length) : keys.indexOf(state.stage);
      show(keys[Math.max(0, Math.min(keys.length - 1, i + (ev.key === "ArrowRight" ? 1 : -1)))]);
    };
    svgEl.onblur = hide;
    if (state.stage != null) show(state.stage);
  }

  function renderTip(k, px, width) {
    const st = stages.find(s => s.key === k);
    const rows = series.filter(s => !state.hidden.has(s.key))
      .map(s => ({ s, v: point(s, k) })).sort((a, b) => b.v.share - a.v.share);
    const tip = $("#tip");
    tip.innerHTML = `<h3>${st.label}: ${fmtPeople(data.totals[k])}</h3>` + rows.map(({ s, v }) =>
      `<div class="row"><span class="sw" style="background:${color(s.key)}"></span>` +
      `<span class="name">${s.label}</span><span class="val">${fmt1(v.share)}%</span></div>` +
      `<div class="row"><span class="sw"></span><span class="name" style="font-size:0.78rem">${fmtPeople(v.count)}</span></div>`).join("");
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > width ? px - 14 - tw : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `8px`;
  }

  // ---------------------------------------------------------------- table, notes
  function buildTable() {
    $("#srTable").innerHTML = `<caption>Share of Texas adults, citizens, registered voters and voters by group, ${data.year}</caption>` +
      `<thead><tr><th>Group</th>${stages.map(s => `<th>${s.label}</th>`).join("")}</tr></thead><tbody>` +
      series.map(s => `<tr><th>${s.label}</th>${s.values.map(v =>
        `<td>${fmt1(v.share)}% (${fmtPeople(v.count)})</td>`).join("")}</tr>`).join("") +
      `<tr><th>Total</th>${stages.map(s => `<td>${fmtPeople(data.totals[s.key])}</td>`).join("")}</tr></tbody>`;
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