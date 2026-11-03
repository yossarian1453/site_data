/* Net votes by Texas county type, 2012-2024: how many more Democratic (above zero) or Republican (below)
 * votes each kind of county produced. The four types add up to the statewide result.
 * Reads margins.json from the county_type_margins folder (written by scripts/county_types.py).
 */
(() => {
  "use strict";

  const CONFIG = {
    dataFile: "../county_type_margins/margins.json",
    version: "1",                          // bump after re-running county_types.py
    heightMessage: "site-data:height",
  };

  const state = { kind: "pres", hidden: new Set(), race: null };
  let data, series;

  const $ = s => document.querySelector(s);
  const color = k => getComputedStyle(document.documentElement).getPropertyValue(`--s-${k}`).trim();
  const short = n => { const a = Math.abs(n); return a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : `${Math.round(a / 1000).toLocaleString("en-US")}K`; };
  const fmtNet = n => n == null ? "—" : Math.abs(n) < 500 ? "Even" : `${n > 0 ? "D" : "R"} +${short(n)}`;
  const fmtAxis = n => n === 0 ? "Even" : `${n > 0 ? "D" : "R"} +${d3.format("~s")(Math.abs(n)).replace("G", "B")}`;
  const races = () => data.races.filter(r => r.kind === state.kind);
  const net = (r, key) => key === "statewide"
    ? Object.values(r.types).reduce((s, t) => s + t.dem - t.gop, 0)
    : r.types[key].dem - r.types[key].gop;
  const tick = r => r.kind === "pres" ? String(r.year) : `${r.year} ${r.label.includes("Senate") ? "Sen." : "Gov."}`;

  async function init() {
    try {
      const res = await fetch(`${CONFIG.dataFile}?v=${CONFIG.version}`);
      if (!res.ok) throw new Error(`${CONFIG.dataFile}: HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the data.</b><br>${err.message}<br>
        This page reads margins.json from the county_type_margins folder, so that folder needs to be published too.</div>`;
      postHeight();
      return;
    }
    series = [...data.types.map(t => ({ key: t.key, label: t.label, counties: t.counties })),
              { key: "statewide", label: "Statewide", dashed: true }];

    document.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", () => {
      state.kind = b.dataset.kind; state.race = null; $("#tip").style.display = "none";
      document.querySelectorAll("[data-kind]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.kind === state.kind)));
      draw();
    }));
    buildLegend();
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

  function buildLegend() {
    const ul = $("#legend");
    ul.innerHTML = "";
    for (const s of series) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", "true");
      b.innerHTML = `<span class="sw" style="background:${color(s.key)}${s.dashed ? ";opacity:.6" : ""}"></span>${s.label}` +
        (s.counties ? ` <span style="color:var(--ink-3)">(${s.counties})</span>` : "");
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

  function draw() {
    const svg = d3.select("#svg");
    const width = $("#chart").clientWidth || 800;
    const narrow = width < 560;
    const height = narrow ? 340 : 420;
    const m = { top: 14, right: narrow ? 14 : 104, bottom: 32, left: narrow ? 52 : 60 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();

    const rs = races();
    const visible = series.filter(s => !state.hidden.has(s.key));
    const vals = rs.flatMap(r => visible.map(s => net(r, s.key))).concat(0);
    const y = d3.scaleLinear().domain(d3.extent(vals)).nice(6).range([ih, 0]);
    const x = d3.scalePoint().domain(rs.map(r => r.key)).range([0, iw]).padding(narrow ? 0.3 : 0.2);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-iw).tickFormat(""));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(fmtAxis))
      .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").remove());
    g.append("g").attr("class", "axis x").attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(10).tickFormat(k => tick(rs.find(r => r.key === k))))
      .call(a => a.select(".domain").remove());
    g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0));

    const line = d3.line().x(p => x(p.r.key)).y(p => y(p.v));
    for (const s of visible) {
      const pts = rs.map(r => ({ r, v: net(r, s.key) }));
      g.append("path").attr("class", `line${s.dashed ? " dashed" : ""}`).attr("stroke", color(s.key))
        .attr("stroke-width", s.dashed ? 1.5 : 2.5).attr("d", line(pts));
      if (!s.dashed)
        g.selectAll(null).data(pts).join("circle").attr("class", "dot").attr("r", 4.5).attr("fill", color(s.key))
          .attr("cx", p => x(p.r.key)).attr("cy", p => y(p.v));
    }

    if (!narrow) {
      const last = rs[rs.length - 1];
      const ends = visible.map(s => ({ s, y: y(net(last, s.key)) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
      for (const { s, y: yy } of ends)
        g.append("text").attr("class", "end-lbl").attr("fill", color(s.key)).attr("x", x(last.key) + 12).attr("y", yy + 4).text(s.label);
    }

    const guide = g.append("line").attr("class", "guide").attr("y1", 0).attr("y2", ih).style("display", "none").lower();
    const keys = rs.map(r => r.key);
    const show = k => {
      state.race = k;
      guide.style("display", null).attr("x1", x(k)).attr("x2", x(k));
      renderTip(k, m.left + x(k), width);
    };
    const hide = () => { state.race = null; guide.style("display", "none"); $("#tip").style.display = "none"; };
    const nearest = px => keys.reduce((a, b) => Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a);
    g.append("rect").attr("class", "hit").attr("x", -8).attr("y", -8).attr("width", iw + 16).attr("height", ih + 16)
      .on("pointermove pointerdown", ev => show(nearest(d3.pointer(ev)[0])))
      .on("pointerleave", ev => { if (ev.pointerType !== "touch") hide(); });
    const svgEl = $("#svg");
    svgEl.onkeydown = ev => {
      if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      ev.preventDefault();
      const i = state.race == null ? (ev.key === "ArrowRight" ? -1 : keys.length) : keys.indexOf(state.race);
      show(keys[Math.max(0, Math.min(keys.length - 1, i + (ev.key === "ArrowRight" ? 1 : -1)))]);
    };
    svgEl.onblur = hide;
    if (state.race != null && keys.includes(state.race)) show(state.race);
  }

  function renderTip(k, px, width) {
    const rs = races();
    const i = rs.findIndex(r => r.key === k);
    const r = rs[i], prev = rs[i - 1];
    const rows = series.filter(s => !state.hidden.has(s.key)).map(s => ({ s, v: net(r, s.key), p: prev ? net(prev, s.key) : null }))
      .sort((a, b) => b.v - a.v);
    const tip = $("#tip");
    tip.innerHTML = `<h3>${r.label}: ${r.dem} vs. ${r.rep}</h3>` + rows.map(({ s, v, p }) =>
      `<div class="row"><span class="sw" style="background:${color(s.key)}"></span><span class="name">${s.label}</span>` +
      `<span class="val">${fmtNet(v)}</span></div>` +
      (p == null ? "" : `<div class="row"><span class="sw"></span><span class="name" style="font-size:0.78rem">` +
        `${Math.abs(v - p) < 500 ? "no change" : `${v - p > 0 ? "D" : "R"} +${short(v - p)}`} vs. ${prev.year}</span></div>`)
    ).join("");
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > width ? px - 14 - tw : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `8px`;
  }

  function buildTable() {
    $("#srTable").innerHTML = `<caption>Net votes by county type, Texas, 2012–2024</caption>` +
      `<thead><tr><th>Race</th>${series.map(s => `<th>${s.label}</th>`).join("")}</tr></thead><tbody>` +
      data.races.map(r => `<tr><th>${r.label}</th>${series.map(s => `<td>${fmtNet(net(r, s.key))}</td>`).join("")}</tr>`).join("") +
      `</tbody>`;
  }

  function buildNotes() {
    $("#notes").innerHTML = `<p><b>Notes.</b> Net votes are the Democratic candidate's votes minus the Republican's; ` +
      `the four county types add up to the statewide result. Midterm races are the top statewide race each year: ` +
      `governor in 2014 and 2022, U.S. Senate in 2018. ${data.category_note}</p>` +
      `<p>Source: <a href="${data.source.url}" target="_blank" rel="noopener">${data.source.label}</a>.</p>`;
  }

  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: $("#app").getBoundingClientRect().bottom + 16 }, "*");
  }

  init();
})();
