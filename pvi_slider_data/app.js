/* Texas Legislature PVI swingometer
 *
 * Reads three files produced by scripts/build.py (+ mapshaper):
 *   house.topo.json, senate.topo.json   district shapes; properties: district, pvi,
 *                                       president_2024_dshare, president_2020_dshare
 *   params.json                         rating bands, majorities, Texas PVI vs. nation,
 *                                       reference results
 *
 * Model (uniform swing on two-party Democratic vote share, in %):
 *   District PVI is measured against the nation (Cook's method).
 *   projected D share = district PVI + national D share
 *   national D share  = Texas D share - Texas PVI vs. nation   (Texas-vote mode)
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- config
  const CONFIG = {
    dataDir: "./",                 // folder holding the data files, relative to index.html
    files: { house: "house.topo.json", senate: "senate.topo.json", params: "params.json" },
    version: "1",                  // bump after re-running build.py so browsers fetch fresh files
    range: { texas: [30, 65], national: [35, 65] },
    heightMessage: "tx-pvi-swing:height",   // postMessage type for auto-sizing the WordPress iframe
  };

  // Rating colors: a diverging scale, blue and red arms around a neutral toss-up.
  const CATS = [
    { key: "safeD",   label: "Safe D",   color: "#1b3b8c", ink: "#ffffff" },
    { key: "likelyD", label: "Likely D", color: "#3f68c8", ink: "#ffffff" },
    { key: "leanD",   label: "Lean D",   color: "#86a6ea", ink: "#14213d" },
    { key: "toss",    label: "Toss-up",  color: "#cdc8bc", ink: "#2a2a27" },
    { key: "leanR",   label: "Lean R",   color: "#eb8088", ink: "#3a0a0f" },
    { key: "likelyR", label: "Likely R", color: "#cc3a47", ink: "#ffffff" },
    { key: "safeR",   label: "Safe R",   color: "#8a1320", ink: "#ffffff" },
  ];
  // Texas Senate, 2026: terms are staggered, so only some seats are on the ballot.
  // Holdovers are the seats not up this year; parties are the current holders.
  // Edit here if the roster changes.
  const SENATE_2026 = {
    up: [1, 2, 3, 4, 5, 9, 11, 13, 18, 19, 21, 22, 24, 26, 28, 31],
    holdovers: { 6: "D", 7: "R", 8: "R", 10: "R", 12: "R", 14: "D", 15: "D", 16: "D",
                 17: "R", 20: "D", 23: "D", 25: "R", 27: "R", 29: "D", 30: "R" },
    nextElection: 2028,
  };

  // Seats not on the ballot: hatched, muted party tints at the ends of the seat bar.
  const hatch = (base, stripe) => `repeating-linear-gradient(45deg, ${stripe} 0 2px, ${base} 2px 6px)`;
  const HELD = [
    { key: "heldD", party: "D", label: "Held D (not up)", base: "#e2e7f4", stripe: "#9fb2dd", ink: "#14213d" },
    { key: "heldR", party: "R", label: "Held R (not up)", base: "#f4e2e4", stripe: "#dda1a7", ink: "#3a0a0f" },
  ];
  HELD.forEach(h => { h.bg = hatch(h.base, h.stripe); h.fill = `url(#pat-${h.key})`; h.color = h.stripe; });
  CATS.forEach(c => { c.bg = c.color; c.fill = c.color; });
  const BAR_CATS = [HELD[0], ...CATS, HELD[1]];
  const CAT = Object.fromEntries(BAR_CATS.map(c => [c.key, c]));
  const CHAMBER_LABEL = { house: "House District", senate: "Senate District" };

  // Zoom presets: [west, south, east, north] in degrees
  const METROS = [
    { label: "All of Texas" },
    { label: "Houston",           bbox: [-95.95, 29.45, -94.95, 30.20] },
    { label: "Dallas–Fort Worth", bbox: [-97.65, 32.55, -96.45, 33.25] },
    { label: "Austin",            bbox: [-98.05, 30.05, -97.40, 30.60] },
    { label: "San Antonio",       bbox: [-98.80, 29.20, -98.20, 29.75] },
    { label: "El Paso",           bbox: [-106.65, 31.60, -106.15, 32.00] },
    { label: "Rio Grande Valley", bbox: [-98.60, 25.85, -97.10, 26.60] },
  ];

  const W = 960, H = 900;
  const state = { chamber: "house", mode: "national", T: 45, color: "ratings", highlight: null, senateView: "2026" };
  const data = {};
  let params, svg, gMap, gDistricts, outlinePath, zoom, path, tipFeature = null, gradient;

  const $ = sel => document.querySelector(sel);
  const f1 = d3.format(".1f");
  const fR = d => f1(100 - +f1(d));   // R share from the rounded D share, so the pair always sums to 100.0
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const pviLabel = x => (x == null ? "–" : Math.abs(x) < 0.5 ? "EVEN" : `${x > 0 ? "D" : "R"}+${Math.round(Math.abs(x))}`);
  const txLean = () => params.texas_pvi_vs_nation;
  const majority = () => params.chambers[state.chamber].majority;
  const seats = () => params.chambers[state.chamber].seats;
  const show2026 = () => state.chamber === "senate" && state.senateView === "2026";
  const heldParty = f => show2026() ? SENATE_2026.holdovers[+f.properties.district] || null : null;

  function rate(share) {
    const b = params.rating_bands, d = share - 50, a = Math.abs(d), side = d > 0 ? "D" : "R";
    if (a < b.tossup) return "toss";
    if (a < b.lean) return "lean" + side;
    if (a < b.likely) return "likely" + side;
    return "safe" + side;
  }

  // ---------------------------------------------------------------- data
  async function getJSON(name) {
    const res = await fetch(`${CONFIG.dataDir}${name}?v=${encodeURIComponent(CONFIG.version)}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res.json();
  }

  function toFeatures(json) {
    if (json.type === "Topology") {
      const obj = json.objects[Object.keys(json.objects)[0]];
      return { features: topojson.feature(json, obj).features, outline: topojson.mesh(json, obj, (a, b) => a === b) };
    }
    return { features: json.features, outline: null };   // plain GeoJSON also works
  }

  // ---------------------------------------------------------------- init
  async function init() {
    try {
      const [p, h, s] = await Promise.all([
        getJSON(CONFIG.files.params), getJSON(CONFIG.files.house), getJSON(CONFIG.files.senate)]);
      params = p;
      data.house = toFeatures(h);
      data.senate = toFeatures(s);
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>Couldn't load the map data.</b><br>${esc(err.message)}<br>
        Check that ${Object.values(CONFIG.files).map(esc).join(", ")} sit next to index.html and that the page is
        served over http(s), not opened as a local file.</div>`;
      postHeight();
      return;
    }
    for (const ch of ["house", "senate"]) {
      data[ch].features.sort((a, b) => +a.properties.district - +b.properties.district);
    }

    // open at the 2024 national result (state.T is kept internally as the implied Texas share)
    const nat24 = params.national.find(n => n.year === 2024);
    state.T = (nat24 ? nat24.dshare : 50) + txLean();

    gradient = d3.scaleDiverging(d3.piecewise(d3.interpolateLab,
      ["#8a1320", "#cc3a47", "#eb8088", "#e8e5de", "#86a6ea", "#3f68c8", "#1b3b8c"]))
      .domain([35, 50, 65]).clamp(true);

    buildControls();
    buildMap();
    buildLegend();
    buildMethod();
    drawChamber();
    syncSlider();
    update();

    new ResizeObserver(postHeight).observe(document.documentElement);
    window.addEventListener("resize", () => update());
  }

  // ---------------------------------------------------------------- controls
  function setPressed(attr, value) {
    document.querySelectorAll(`[data-${attr}]`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
  }

  function buildControls() {
    document.querySelectorAll("[data-chamber]").forEach(b => b.addEventListener("click", () => {
      if (state.chamber === b.dataset.chamber) return;
      state.chamber = b.dataset.chamber;
      state.highlight = null;
      setPressed("chamber", state.chamber);
      $("#senateView").hidden = state.chamber !== "senate";
      hideTip();
      drawChamber();
      update();
    }));
    document.querySelectorAll("[data-sview]").forEach(b => b.addEventListener("click", () => {
      state.senateView = b.dataset.sview;
      state.highlight = null;
      setPressed("sview", state.senateView);
      update();
    }));
    document.querySelectorAll("[data-color]").forEach(b => b.addEventListener("click", () => {
      state.color = b.dataset.color;
      setPressed("color", state.color);
      update();
    }));

    $("#vote").addEventListener("input", e => {
      const v = mirror(+e.target.value);
      state.T = state.mode === "texas" ? v : v + txLean();
      update();
    });

    const metro = $("#metro");
    METROS.forEach((m, i) => metro.add(new Option(m.label, String(i))));
    metro.addEventListener("change", () => {
      const m = METROS[+metro.value];
      m.bbox ? zoomToBBox(m.bbox) : resetZoom();
    });
    $("#zoomIn").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1.8));
    $("#zoomOut").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.8));
    $("#zoomReset").addEventListener("click", () => { metro.value = "0"; resetZoom(); });

    $("#tableWrap").addEventListener("toggle", () => { renderTable(); postHeight(); });
  }

  // Reference results shown as ticks and chips, in the slider's current units
  function references() {
    if (state.mode === "texas") {
      return params.reference.map(r => ({ label: r.label, value: r.texas_dshare }));
    }
    return params.national
      .slice().sort((a, b) => a.year - b.year)
      .map(n => ({ label: `${n.year} President`, value: n.dshare }));
  }

  function sliderValue() {
    return state.mode === "texas" ? state.T : state.T - txLean();
  }

  // The slider runs Democratic (left) to Republican (right), so its raw value is the D share mirrored.
  function mirror(x) {
    const [lo, hi] = CONFIG.range[state.mode];
    return lo + hi - x;
  }

  function syncSlider() {
    const [lo, hi] = CONFIG.range[state.mode];
    const input = $("#vote");
    input.min = lo;
    input.max = hi;
    input.value = mirror(clamp(sliderValue(), lo, hi));
    input.setAttribute("aria-label", state.mode === "texas"
      ? "Texas two-party vote, Democratic to Republican" : "National two-party vote, Democratic to Republican");

    const pos = v => `calc(${(hi - v) / (hi - lo)} * (100% - var(--thumb)) + var(--thumb) / 2)`;
    const refs = references().filter(r => r.value >= lo && r.value <= hi);
    const ticks = $("#ticks");
    ticks.innerHTML = "";
    const mid = document.createElement("i");
    mid.className = "mid";
    mid.style.left = pos(50);
    ticks.append(mid);
    for (const r of refs) {
      const t = document.createElement("i");
      t.style.left = pos(r.value);
      ticks.append(t);
    }

    const chips = $("#chips");
    chips.innerHTML = "";
    for (const r of references()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.value = r.value;
      b.textContent = r.label;
      b.title = `${r.label}: D ${f1(r.value)}% · R ${fR(r.value)}%`;
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => {
        state.T = state.mode === "texas" ? r.value : r.value + txLean();
        input.value = mirror(clamp(sliderValue(), lo, hi));
        update();
      });
      chips.append(b);
    }
  }

  // ---------------------------------------------------------------- map
  function buildMap() {
    svg = d3.select("#map").attr("viewBox", `0 0 ${W} ${H}`);
    const defs = svg.append("defs");
    for (const h of HELD) {
      const pat = defs.append("pattern").attr("id", `pat-${h.key}`).attr("patternUnits", "userSpaceOnUse")
        .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
      pat.append("rect").attr("width", 6).attr("height", 6).attr("fill", h.base);
      pat.append("rect").attr("width", 2).attr("height", 6).attr("fill", h.stripe);
    }
    gMap = svg.append("g");
    gDistricts = gMap.append("g");
    outlinePath = gMap.append("path").attr("class", "outline");

    const projection = d3.geoConicEqualArea().parallels([27.5, 35]).rotate([100, 0])
      .fitExtent([[12, 12], [W - 12, H - 12]], { type: "FeatureCollection", features: data.house.features });
    path = d3.geoPath(projection);

    zoom = d3.zoom()
      .scaleExtent([1, 40])
      .translateExtent([[0, 0], [W, H]])
      .filter(ev => {
        if (ev.type === "wheel") return ev.ctrlKey || ev.metaKey;
        if (ev.type.startsWith("touch")) return ev.touches.length > 1 || d3.zoomTransform(svg.node()).k > 1;
        return !ev.button;
      })
      .on("zoom", ev => {
        gMap.attr("transform", ev.transform);
        defs.selectAll("pattern").attr("patternTransform", `rotate(45) scale(${1 / ev.transform.k})`);
      });
    svg.call(zoom).on("dblclick.zoom", null);

    let hintTimer;
    svg.on("wheel.hint", ev => {
      if (ev.ctrlKey || ev.metaKey) return;
      $("#hint").classList.add("show");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => $("#hint").classList.remove("show"), 1400);
    });
    svg.on("click.tip", ev => { if (!ev.target.classList.contains("district")) hideTip(); });

    METROS.forEach(m => { if (m.bbox) m.box = [projection([m.bbox[0], m.bbox[3]]), projection([m.bbox[2], m.bbox[1]])]; });
  }

  function zoomToBBox(bbox) {
    const m = METROS.find(x => x.bbox === bbox);
    const [[x0, y0], [x1, y1]] = m.box;
    const k = Math.min(40, 0.92 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    svg.transition().duration(650).call(zoom.transform,
      d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  }

  function resetZoom() {
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  }

  function drawChamber() {
    const { features, outline } = data[state.chamber];
    gDistricts.selectAll("path.district")
      .data(features, d => d.properties.district)
      .join("path")
      .attr("class", "district")
      .attr("d", path)
      .on("pointerenter pointermove", (ev, d) => showTip(ev, d))
      .on("pointerleave", ev => { if (ev.pointerType !== "touch") hideTip(); })
      .on("click", (ev, d) => showTip(ev, d));
    outlinePath.attr("d", outline ? path(outline) : null);

    const actual = latestActualKey();
    $("#thActual").textContent = actual ? `${actual.year} pres. D` : "Pres. D";
  }

  // ---------------------------------------------------------------- update
  function projected(f) {
    const p = f.properties.pvi;
    return p == null ? null : clamp(p + state.T - txLean(), 0, 100);   // PVI + national D share
  }

  function update() {
    const features = data[state.chamber].features;
    const counts = Object.fromEntries(BAR_CATS.map(c => [c.key, 0]));
    let dLead = 0, rLead = 0;
    for (const f of features) {
      const s = projected(f), held = heldParty(f);
      f.properties._share = s;
      f.properties._held = held;
      f.properties._cat = held ? `held${held}` : s == null ? null : rate(s);
      if (held) {
        counts[f.properties._cat]++;
        if (held === "D") dLead++; else rLead++;
        continue;
      }
      if (s == null) continue;
      counts[f.properties._cat]++;
      if (s > 50) dLead++; else if (s < 50) rLead++;
    }

    gDistricts.selectAll("path.district")
      .style("fill", f => f.properties._held ? CAT[f.properties._cat].fill
        : f.properties._share == null ? "#e3e1db"
        : state.color === "gradient" ? gradient(f.properties._share) : CAT[f.properties._cat].fill)
      .classed("dim", f => state.highlight != null && f.properties._cat !== state.highlight);

    renderBar(counts, dLead, rLead);
    renderLegend();
    renderReadout();
    renderTable();
    if (tipFeature) renderTip(tipFeature);
  }

  function renderBar(counts, dLead, rLead) {
    const bar = $("#bar");
    const width = bar.clientWidth || 600;
    const n = seats();
    const btns = d3.select(bar).selectAll("button").data(BAR_CATS, c => c.key).join(enter => enter.append("button")
      .attr("type", "button")
      .style("background", c => c.bg)
      .style("color", c => c.ink)
      .on("mouseenter focus", (ev, c) => setHighlight(c.key))
      .on("mouseleave blur", () => setHighlight(null))
      .on("click", (ev, c) => setHighlight(state.highlight === c.key ? null : c.key)));
    btns
      .style("flex-grow", c => counts[c.key])
      .style("flex-basis", "0px")
      .style("display", c => counts[c.key] ? "flex" : "none")
      .attr("aria-label", c => `${c.label}: ${counts[c.key]} seats`)
      .text(c => (counts[c.key] / n) * width >= 22 ? counts[c.key] : "");

    const dSure = counts.heldD + counts.safeD + counts.likelyD + counts.leanD;
    const rSure = counts.heldR + counts.safeR + counts.likelyR + counts.leanR;
    $("#dTotal").textContent = dSure;
    $("#rTotal").textContent = rSure;

    const maj = majority();
    const control = dLead >= maj ? `<b style="color:var(--d)">Democratic majority</b>`
      : rLead >= maj ? `<b style="color:var(--r)">Republican majority</b>` : `<b>No majority</b>`;
    const toss = counts.toss;
    const held = counts.heldD + counts.heldR;
    $("#tallyNote").innerHTML =
      `<span class="nw">${maj} seats for a majority</span> · ` +
      (held ? `<span class="nw">${n - held} seats up in 2026, ${held} held until ${SENATE_2026.nextElection}</span> · ` : "") +
      `<span class="nw">${toss} toss-up${toss === 1 ? "" : "s"}</span> · ` +
      `<span class="nw">${held ? "Projected chamber" : "Leading"}: D ${dLead}, R ${rLead}</span> <span class="nw">→ ${control}</span>`;
  }

  function setHighlight(key) {
    state.highlight = key;
    gDistricts.selectAll("path.district")
      .classed("dim", f => key != null && f.properties._cat !== key);
  }

  function renderReadout() {
    const v = sliderValue();
    const share = d => `<span class="d">D ${f1(d)}%</span> · <span class="r">R ${fR(d)}%</span>`;
    const n = clamp(state.T - txLean(), 0, 100);
    $("#readoutNational").innerHTML = share(n);
    $("#vote").setAttribute("aria-valuetext", `Democrats ${f1(n)}%, Republicans ${fR(n)}%`);
    $("#readoutTexas").innerHTML = share(state.T);
    const m = 2 * n - 100;       // national two-party margin (D minus R)
    const marginText = Math.abs(m) < 0.05 ? "Tied" : `${m > 0 ? "D" : "R"}+${f1(Math.abs(m))}%`;
    $("#readoutSub").textContent =
      `${state.mode === "texas" ? "Equivalent national House popular vote margin" : "National House popular vote margin"}: ${marginText}`;
    document.querySelectorAll(".chip").forEach(b =>
      b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.value - v) < 0.05)));
  }

  // ---------------------------------------------------------------- tooltip
  function actualKeys(props) {
    return Object.keys(props)
      .map(k => /^president_(\d{4})_dshare$/.exec(k))
      .filter(Boolean)
      .map(m => ({ key: m[0], year: +m[1] }))
      .sort((a, b) => b.year - a.year);
  }

  function latestActualKey() {
    const f = data[state.chamber].features[0];
    return f ? actualKeys(f.properties)[0] : null;
  }

  function renderTip(f) {
    const p = f.properties, s = p._share, cat = p._cat ? CAT[p._cat] : null;
    const rows = [
      ["PVI", pviLabel(p.pvi)],
      ...actualKeys(p).map(({ key, year }) => [`${year} president, D share`, p[key] == null ? "–" : `${f1(p[key])}%`]),
      p._held
        ? ["Current holder", p._held === "D" ? "Democrat" : "Republican"]
        : ["Projected", s == null ? "–" : `D ${f1(s)}% · R ${fR(s)}%`],
    ];
    const ratingText = p._held ? `Not up until ${SENATE_2026.nextElection}` : cat ? cat.label : "";
    $("#tip").innerHTML =
      `<h3>${CHAMBER_LABEL[state.chamber]} ${esc(p.district)}</h3>` +
      rows.map(([a, b]) => `<div class="row"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join("") +
      (cat ? `<div class="rating"><span class="sw" style="background:${cat.bg}"></span>${ratingText}</div>` : "");
  }

  function showTip(ev, f) {
    tipFeature = f;
    gDistricts.selectAll("path.district").classed("hover", d => d === f);
    d3.select(ev.currentTarget).raise();
    renderTip(f);
    const tip = $("#tip");
    tip.style.display = "block";
    const pad = 14, tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + tw > window.innerWidth - 4) x = ev.clientX - tw - pad;
    if (y + th > window.innerHeight - 4) y = ev.clientY - th - pad;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  }

  function hideTip() {
    tipFeature = null;
    $("#tip").style.display = "none";
    if (gDistricts) gDistricts.selectAll("path.district.hover").classed("hover", false);
  }

  // ---------------------------------------------------------------- legend, table, method
  function renderLegend() {
    const b = params.rating_bands, m = x => +(2 * x).toFixed(1);   // bands are stored in share points
    const cats = show2026() ? BAR_CATS : CATS;
    $("#legend").innerHTML = cats.map(c => `<li><span class="sw" style="background:${c.bg}"></span>${c.label}</li>`).join("") +
      `<li>Projected margin: toss-up &lt;${m(b.tossup)}, lean ${m(b.tossup)}–${m(b.lean)}, likely ${m(b.lean)}–${m(b.likely)}, safe ${m(b.likely)}+ pts</li>`;
  }

  function buildLegend() {
    // slider track = the map's gradient, Democratic 65% on the left to Republican 65% on the right
    $("#vote").style.setProperty("--track",
      `linear-gradient(90deg, ${d3.range(65, 34.99, -1.5).map(v => gradient(v)).join(",")})`);
  }

  function renderTable() {
    if (!$("#tableWrap").open) return;
    const actual = latestActualKey();
    $("#tableNote").textContent = show2026()
      ? `Showing the ${SENATE_2026.up.length} seats on the 2026 ballot. The other ${Object.keys(SENATE_2026.holdovers).length} are held until ${SENATE_2026.nextElection}.`
      : "";
    const rows = data[state.chamber].features
      .filter(f => f.properties._share != null && !f.properties._held)
      .slice()
      .sort((a, b) => Math.abs(a.properties._share - 50) - Math.abs(b.properties._share - 50));
    $("#tbody").innerHTML = rows.map(f => {
      const p = f.properties, c = CAT[p._cat];
      return `<tr><td>${esc(p.district)}</td><td>${pviLabel(p.pvi)}</td>` +
        `<td>${actual && p[actual.key] != null ? f1(p[actual.key]) + "%" : "–"}</td>` +
        `<td>${f1(p._share)}%</td><td>${fR(p._share)}%</td>` +
        `<td><span class="sw" style="background:${c.bg}"></span>${c.label}</td></tr>`;
    }).join("");
  }

  function buildMethod() {
    const races = params.pvi_races.map(r => `${Math.round(r.weight * 100)}% ${r.year}`).join(" + ");
    $("#method").innerHTML =
      `<p><b>How it works.</b> Each district's PVI blends the two-party presidential vote (${races}) and is measured
       against the nation as a whole, the same way the Cook Political Report calculates PVI for congressional districts.
       The projection moves every district by the same amount as the national environment:
       projected Democratic share = PVI + the national Democratic share. The Texas statewide vote shown is the one
       implied by the national vote and Texas's own PVI (${pviLabel(txLean())}). Districts are sorted in the table from closest to safest.
       In the Senate's default view, only the ${SENATE_2026.up.length} seats on the 2026 ballot are projected; the other
       ${Object.keys(SENATE_2026.holdovers).length} are not up for election this year and count for their current party.</p>
       <p>This is a uniform-swing illustration, not a forecast: it ignores candidates, incumbency, turnout differences
       and uncontested races. Sources: <a href="https://data.capitol.texas.gov/dataset/comprehensive-election-datasets-compressed-format" target="_blank" rel="noopener">Texas Legislative Council election data</a> (2020, 2024);
       national totals from the <a href="https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/" target="_blank" rel="noopener">FEC</a>.</p>`;
  }

  // ---------------------------------------------------------------- iframe sizing
  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ type: CONFIG.heightMessage, height: document.documentElement.scrollHeight }, "*");
  }

  init();
})();