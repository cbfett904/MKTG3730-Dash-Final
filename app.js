/**
 * MKTG 3730 Social Tracker — Dashboard
 * Features: filters, sortable table, interactive comparison chart,
 * FB vs IG breakdown, factor-influence scatter, CSV export
 */

const DATA_URL = "./data.json";
const el = (id) => document.getElementById(id);
const normalize = (s) => String(s ?? "").trim().toLowerCase();
const isNumberLike = (v) => v != null && v !== "" && !isNaN(Number(String(v).replace(/,/g, "")));
const toNumber = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/* ─── palette for charts ─── */
const PALETTE = [
  "#532E1F","#F1C500","#B8860B","#8B5E3C","#D4A843",
  "#3D5A80","#98C1D9","#E07A5F","#81B29A","#F2CC8F",
  "#6D597A","#E56B6F"
];
const colorFor = (i) => PALETTE[i % PALETTE.length];

const state = {
  headers: [],
  rows: [],        // all rows
  dataRows: [],    // excludes TOTALS-type summary rows
  filtered: [],
  sort: [],
  // comparison chart
  selectedAccounts: new Set(),
  selectedMetrics: new Set(),
};

let charts = {};  // keyed by canvas id

function setStatus(msg) { el("status").textContent = msg; }

function isTotalsRow(r) {
  const bp = String(r["Brand Page"] ?? "").trim().toUpperCase();
  return bp.startsWith("TOTAL") || bp.startsWith("AVG") || bp.includes("TOTALS");
}

function getKeyCaseInsensitive(obj, wanted) {
  const w = normalize(wanted);
  return Object.keys(obj).find(k => normalize(k) === w) || null;
}

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(v => String(v ?? "").trim() !== "")))
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

function buildSelect(selectEl, values, allLabel) {
  selectEl.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = ""; o0.textContent = allLabel;
  selectEl.appendChild(o0);
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = String(v); o.textContent = String(v);
    selectEl.appendChild(o);
  });
}

/* ─── NUMERIC METRIC KEYS (columns that have actual numeric data) ─── */
function getNumericMetricKeys(rows) {
  if (!rows.length) return [];
  const skip = new Set(["class", "team", "growth %"]);
  return Object.keys(rows[0]).filter(k => {
    if (skip.has(normalize(k))) return false;
    // at least one row has a real nonzero number
    return rows.some(r => {
      const v = toNumber(r[k]);
      return v !== 0;
    });
  }).filter(k => {
    // must be predominantly numeric
    const nums = rows.filter(r => isNumberLike(r[k])).length;
    return nums > rows.length * 0.3;
  });
}

/* ════════════════════════════════════════
   KPIs — simplified strip
   ════════════════════════════════════════ */
function renderKpis(rows) {
  const wrap = el("kpis");
  wrap.innerHTML = "";

  const dataOnly = rows.filter(r => !isTotalsRow(r));

  const make = (label, value) => {
    const d = document.createElement("div");
    d.className = "kpi";
    d.innerHTML = `<div class="kpi__label">${label}</div><div class="kpi__value">${value}</div>`;
    return d;
  };

  wrap.appendChild(make("Pages", dataOnly.length));

  const sample = dataOnly[0] || {};
  const pairs = [
    ["Final Followers", "Final Followers"],
    ["Total Growth", "Follower Growth"],
    ["UP3\u2192Final", "UP3\u2192Final Growth"],
    ["Final Reach", "Final Reach"],
  ];
  pairs.forEach(([label, wanted]) => {
    const k = getKeyCaseInsensitive(sample, wanted);
    if (k) {
      const sum = dataOnly.reduce((a, r) => a + toNumber(r[k]), 0);
      wrap.appendChild(make(label, sum.toLocaleString()));
    }
  });
}

/* ════════════════════════════════════════
   1K FOLLOWER GOAL TRACKER
   ════════════════════════════════════════ */
function renderGoalTracker(rows) {
  const grid = el("goalGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const dataOnly = rows.filter(r => !isTotalsRow(r));

  // Group by brand -> best final-follower count across platforms
  const byBrand = new Map();
  dataOnly.forEach(r => {
    const brand = r["Brand Page"];
    if (!brand) return;
    const final = toNumber(r["Final Followers"]);
    const platform = r["Platform"];
    const curr = byBrand.get(brand) || { best: 0, bestPlatform: null };
    if (final > curr.best) {
      curr.best = final;
      curr.bestPlatform = platform;
    }
    byBrand.set(brand, curr);
  });

  const GOAL = 1000;
  const brands = Array.from(byBrand.entries())
    .map(([brand, info]) => ({ brand, ...info, hit: info.best >= GOAL }))
    .sort((a, b) => b.best - a.best);

  const hitCount = brands.filter(b => b.hit).length;

  // Update big score
  const goalHit = el("goalHit");
  const goalTotal = el("goalTotal");
  if (goalHit)   goalHit.textContent = hitCount;
  if (goalTotal) goalTotal.textContent = brands.length;

  // Render grid items
  brands.forEach(b => {
    const item = document.createElement("div");
    item.className = "goal-item " + (b.hit ? "goal-item--hit" : "goal-item--miss");
    const display = b.best > 0 ? b.best.toLocaleString() : "\u2014";
    item.innerHTML = `
      <div class="goal-item__check" aria-hidden="true">${b.hit ? "\u2713" : ""}</div>
      <div class="goal-item__brand" title="${b.brand}">${b.brand}</div>
      <div class="goal-item__count">${display}</div>
    `;
    grid.appendChild(item);
  });
}

/* ════════════════════════════════════════
   CHART HELPERS
   ════════════════════════════════════════ */
function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { font: { family: "'DM Sans'", size: 11, weight: 600 }, boxWidth: 12, padding: 10 } },
      tooltip: {
        backgroundColor: "rgba(26,26,26,.88)",
        titleFont: { family: "'DM Sans'", size: 12, weight: 700 },
        bodyFont: { family: "'DM Sans'", size: 11 },
        padding: 10, cornerRadius: 8, boxPadding: 4,
      }
    },
    scales: {
      x: { ticks: { font: { family: "'DM Sans'", size: 11 } }, grid: { color: "rgba(0,0,0,.04)" } },
      y: { ticks: { font: { family: "'DM Sans'", size: 11 } }, grid: { color: "rgba(0,0,0,.06)" }, beginAtZero: true },
    }
  };
}

/* ════════════════════════════════════════
   INTERACTIVE COMPARISON CHART
   ════════════════════════════════════════ */
function buildComparisonControls(dataRows) {
  const accountWrap = el("accountChips");
  const metricWrap = el("metricChips");
  accountWrap.innerHTML = "";
  metricWrap.innerHTML = "";

  // unique brand pages (excluding totals)
  const brands = uniqSorted(dataRows.map(r => r["Brand Page"]));
  brands.forEach(b => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = b;
    chip.dataset.value = b;
    if (state.selectedAccounts.has(b)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      if (state.selectedAccounts.has(b)) state.selectedAccounts.delete(b);
      else state.selectedAccounts.add(b);
      chip.classList.toggle("active");
      renderCompareChart(dataRows);
    });
    accountWrap.appendChild(chip);
  });

  // metric chips
  const metrics = getNumericMetricKeys(dataRows).filter(k => normalize(k) !== "brand page" && normalize(k) !== "platform");
  metrics.forEach(m => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = m;
    chip.dataset.value = m;
    if (state.selectedMetrics.has(m)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      if (state.selectedMetrics.has(m)) state.selectedMetrics.delete(m);
      else state.selectedMetrics.add(m);
      chip.classList.toggle("active");
      renderCompareChart(dataRows);
    });
    metricWrap.appendChild(chip);
  });

  // Default selections if empty
  if (state.selectedAccounts.size === 0 && brands.length) {
    brands.slice(0, 3).forEach(b => state.selectedAccounts.add(b));
    accountWrap.querySelectorAll(".chip").forEach(c => {
      if (state.selectedAccounts.has(c.dataset.value)) c.classList.add("active");
    });
  }
  if (state.selectedMetrics.size === 0 && metrics.length) {
    const defaultMetrics = ["Final Followers", "Follower Growth"].filter(m => metrics.includes(m));
    (defaultMetrics.length ? defaultMetrics : metrics.slice(0, 2)).forEach(m => state.selectedMetrics.add(m));
    metricWrap.querySelectorAll(".chip").forEach(c => {
      if (state.selectedMetrics.has(c.dataset.value)) c.classList.add("active");
    });
  }
}

function renderCompareChart(dataRows) {
  destroyChart("compareChart");

  const accounts = Array.from(state.selectedAccounts);
  const metrics = Array.from(state.selectedMetrics);

  if (!accounts.length || !metrics.length) return;

  // For each account, aggregate across platforms (sum)
  const accountData = new Map();
  accounts.forEach(a => {
    const matching = dataRows.filter(r => r["Brand Page"] === a);
    const agg = {};
    metrics.forEach(m => {
      agg[m] = matching.reduce((s, r) => s + toNumber(r[m]), 0);
    });
    accountData.set(a, agg);
  });

  const datasets = metrics.map((m, mi) => ({
    label: m,
    data: accounts.map(a => accountData.get(a)[m] || 0),
    backgroundColor: colorFor(mi),
    borderColor: colorFor(mi),
    borderWidth: 1,
    borderRadius: 4,
  }));

  const ctx = el("compareChart").getContext("2d");
  const opts = chartDefaults();
  opts.plugins.legend.display = true;

  charts["compareChart"] = new Chart(ctx, {
    type: "bar",
    data: { labels: accounts, datasets },
    options: opts
  });
}

/* ════════════════════════════════════════
   FB vs IG CHART
   ════════════════════════════════════════ */
function renderFbIgChart(dataRows) {
  destroyChart("fbIgChart");

  // group by brand, get IG and FB follower growth
  const brands = uniqSorted(dataRows.map(r => r["Brand Page"]));
  const metricKey = getKeyCaseInsensitive(dataRows[0] || {}, "Follower Growth") || "Follower Growth";

  const igData = [];
  const fbData = [];
  const labels = [];

  brands.forEach(b => {
    const igRow = dataRows.find(r => r["Brand Page"] === b && r["Platform"] === "Instagram");
    const fbRow = dataRows.find(r => r["Brand Page"] === b && r["Platform"] === "Facebook");

    const igFollowers = igRow ? toNumber(igRow["Final Followers"] ?? igRow["UP3 Followers"]) : 0;
    const fbFollowers = fbRow ? toNumber(fbRow["Final Followers"] ?? fbRow["UP3 Followers"]) : 0;

    // skip if not on either platform
    if (igFollowers === 0 && fbFollowers === 0) return;

    labels.push(b);
    // use follower growth; if zero, treat as "no data for that platform"
    const igVal = igRow ? toNumber(igRow[metricKey]) : 0;
    const fbVal = fbRow ? toNumber(fbRow[metricKey]) : 0;
    igData.push(igVal > 0 ? igVal : null);
    fbData.push(fbVal > 0 ? fbVal : null);
  });

  const ctx = el("fbIgChart").getContext("2d");
  const opts = chartDefaults();
  opts.plugins.legend.display = true;
  opts.skipNull = true;

  charts["fbIgChart"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Instagram",
          data: igData,
          backgroundColor: "rgba(225,48,108,.75)",
          borderColor: "rgba(225,48,108,1)",
          borderWidth: 1, borderRadius: 4,
        },
        {
          label: "Facebook",
          data: fbData,
          backgroundColor: "rgba(66,103,178,.75)",
          borderColor: "rgba(66,103,178,1)",
          borderWidth: 1, borderRadius: 4,
        }
      ]
    },
    options: opts
  });
}

/* ════════════════════════════════════════
   FACTOR INFLUENCE (scatter)
   ════════════════════════════════════════ */
function buildInfluenceControls(dataRows) {
  const metrics = getNumericMetricKeys(dataRows);
  const xSel = el("influenceX");
  const ySel = el("influenceY");

  const build = (sel, defaultVal) => {
    sel.innerHTML = "";
    metrics.forEach(m => {
      const o = document.createElement("option");
      o.value = m; o.textContent = m;
      if (m === defaultVal) o.selected = true;
      sel.appendChild(o);
    });
  };

  const xDefault = metrics.find(m => normalize(m) === "final posts") || metrics.find(m => normalize(m).includes("posts")) || metrics[0];
  const yDefault = metrics.find(m => normalize(m) === "follower growth") || metrics.find(m => normalize(m).includes("follower")) || metrics[1];

  build(xSel, xDefault);
  build(ySel, yDefault);

  const update = () => renderInfluenceChart(dataRows);
  xSel.addEventListener("change", update);
  ySel.addEventListener("change", update);
  el("influencePlatform").addEventListener("change", update);
}

function renderInfluenceChart(dataRows) {
  destroyChart("influenceChart");

  const xKey = el("influenceX").value;
  const yKey = el("influenceY").value;
  const platFilter = el("influencePlatform").value;

  if (!xKey || !yKey) return;

  let rows = dataRows;
  if (platFilter) rows = rows.filter(r => r["Platform"] === platFilter);

  const points = [];
  rows.forEach(r => {
    const x = toNumber(r[xKey]);
    const y = toNumber(r[yKey]);
    // skip zeros (we treat zero as "no data")
    if (x === 0 || y === 0) return;
    points.push({ x, y, label: `${r["Brand Page"]} (${r["Platform"]})` });
  });

  const ctx = el("influenceChart").getContext("2d");
  const opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => {
      const p = points[ctx.dataIndex];
      return p ? `${p.label}: (${p.x}, ${p.y})` : "";
    }
  };
  opts.scales.x.title = { display: true, text: xKey, font: { family: "'DM Sans'", size: 12, weight: 700 } };
  opts.scales.y.title = { display: true, text: yKey, font: { family: "'DM Sans'", size: 12, weight: 700 } };

  charts["influenceChart"] = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [{
        data: points.map(p => ({ x: p.x, y: p.y })),
        backgroundColor: "rgba(83,46,31,.7)",
        borderColor: "rgba(83,46,31,.9)",
        borderWidth: 1.5,
        pointRadius: 6,
        pointHoverRadius: 9,
      }]
    },
    options: opts
  });

  // Simple correlation stats
  const statsEl = el("influenceStats");
  if (points.length < 3) {
    statsEl.textContent = "Not enough data points to compute correlation.";
    return;
  }
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);
  const sumY2 = ys.reduce((a, y) => a + y * y, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const r = den === 0 ? 0 : num / den;

  let strength = "no";
  const absR = Math.abs(r);
  if (absR > 0.7) strength = "strong";
  else if (absR > 0.4) strength = "moderate";
  else if (absR > 0.2) strength = "weak";

  const direction = r > 0 ? "positive" : r < 0 ? "negative" : "no";
  statsEl.innerHTML = `<strong>${n} data points</strong> · Pearson r = <strong>${r.toFixed(3)}</strong> — indicates a <strong>${strength} ${direction}</strong> correlation between ${xKey} and ${yKey}.`;
}

/* ════════════════════════════════════════
   PLATFORM + BRAND SUMMARY CHARTS
   ════════════════════════════════════════ */
function renderPlatformChart(dataRows) {
  destroyChart("platformChart");
  const byPlat = new Map();
  dataRows.forEach(r => {
    const p = String(r["Platform"] ?? "Unknown").trim() || "Unknown";
    byPlat.set(p, (byPlat.get(p) || 0) + 1);
  });
  const labels = Array.from(byPlat.keys());
  const values = labels.map(k => byPlat.get(k));

  const ctx = el("platformChart").getContext("2d");
  const opts = chartDefaults();
  opts.plugins.legend.display = false;

  charts["platformChart"] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: ["rgba(225,48,108,.75)", "rgba(66,103,178,.75)"], borderWidth: 2, borderColor: "#fff" }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: opts.plugins,
      cutout: "55%"
    }
  });
}

function renderBrandChart(dataRows) {
  destroyChart("brandChart");
  const sample = dataRows[0] || {};
  const metricKey = getKeyCaseInsensitive(sample, "Follower Growth") || getKeyCaseInsensitive(sample, "UP2 Followers");
  if (!metricKey) return;

  // aggregate by brand across platforms
  const byBrand = new Map();
  dataRows.forEach(r => {
    const b = String(r["Brand Page"] ?? "").trim();
    if (!b) return;
    byBrand.set(b, (byBrand.get(b) || 0) + toNumber(r[metricKey]));
  });

  const brands = Array.from(byBrand.keys()).sort((a, b) => (byBrand.get(b) || 0) - (byBrand.get(a) || 0));
  const top = brands.slice(0, 10);
  const values = top.map(b => byBrand.get(b));

  const ctx = el("brandChart").getContext("2d");
  const opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.indexAxis = "y";

  charts["brandChart"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top,
      datasets: [{
        data: values,
        backgroundColor: top.map((_, i) => colorFor(i)),
        borderRadius: 4,
      }]
    },
    options: opts
  });
}

/* ════════════════════════════════════════
   TABLE
   ════════════════════════════════════════ */
function applySort(rows) {
  if (!state.sort.length) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const s of state.sort) {
      const av = a[s.key], bv = b[s.key];
      const num = isNumberLike(av) && isNumberLike(bv);
      let cmp = num
        ? toNumber(av) - toNumber(bv)
        : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp * s.dir;
    }
    return 0;
  });
  return sorted;
}

function toggleSort(key, additive) {
  const idx = state.sort.findIndex(s => s.key === key);
  if (!additive) state.sort = [];
  if (idx === -1) state.sort.push({ key, dir: 1 });
  else if (state.sort[idx].dir === 1) state.sort[idx].dir = -1;
  else state.sort.splice(idx, 1);
}

function renderTable(headers, rows) {
  const table = el("table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";

  const tr = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.dataset.key = h;
    const active = state.sort.find(s => s.key === h);
    const arrow = active ? (active.dir === 1 ? "▲" : "▼") : "";
    th.innerHTML = `${h || "(blank)"} <span class="sort">${arrow}</span>`;
    th.addEventListener("click", (e) => {
      toggleSort(h, e.shiftKey);
      applyFilters();
    });
    tr.appendChild(th);
  });
  thead.appendChild(tr);

  rows.forEach(r => {
    const trb = document.createElement("tr");
    if (isTotalsRow(r)) trb.classList.add("row--totals");
    headers.forEach(h => {
      const td = document.createElement("td");
      const v = r[h];
      td.textContent = v == null ? "—" : String(v);
      trb.appendChild(td);
    });
    tbody.appendChild(trb);
  });

  el("rowCount").textContent = `${rows.length} rows`;
}

/* ════════════════════════════════════════
   FILTERS
   ════════════════════════════════════════ */
function applyFilters() {
  const q = normalize(el("search").value);
  const c = el("filterClass").value;
  const p = el("filterPlatform").value;
  const t = el("filterTeam").value;

  const filtered = state.rows.filter(r => {
    if (c && String(r["Class"] ?? "") !== c) return false;
    if (p && String(r["Platform"] ?? "") !== p) return false;
    if (t && String(r["Brand Page"] ?? "") !== t) return false;
    if (q) {
      let ok = false;
      for (const h of state.headers) {
        if (normalize(r[h]).includes(q)) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  });

  const sorted = applySort(filtered);
  state.filtered = sorted;

  const dataFiltered = sorted.filter(r => !isTotalsRow(r));

  renderKpis(sorted);
  renderGoalTracker(sorted);
  renderPlatformChart(dataFiltered);
  renderBrandChart(dataFiltered);
  renderFbIgChart(dataFiltered);
  renderCompareChart(dataFiltered);
  renderInfluenceChart(dataFiltered);
  renderTable(state.headers, sorted);
}

function clearFilters() {
  el("search").value = "";
  el("filterClass").value = "";
  el("filterPlatform").value = "";
  el("filterTeam").value = "";
  state.sort = [];
  applyFilters();
}

/* ════════════════════════════════════════
   CSV EXPORT
   ════════════════════════════════════════ */
function downloadFilteredCsv() {
  const headers = state.headers;
  const rows = state.filtered;
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(esc).join(",")];
  rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "mktg3730_filtered.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════
   INIT
   ════════════════════════════════════════ */
async function loadData() {
  try {
    setStatus("Loading…");
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load data.json (${res.status})`);
    const payload = await res.json();
    const rows = payload.rows || [];
    if (!rows.length) throw new Error("data.json has no rows.");

    state.rows = rows;
    state.headers = Object.keys(rows[0]);
    state.dataRows = rows.filter(r => !isTotalsRow(r));

    buildSelect(el("filterClass"), uniqSorted(rows.map(r => r["Class"])), "All classes");
    buildSelect(el("filterPlatform"), uniqSorted(rows.map(r => r["Platform"])), "All platforms");

    // Brand-name dropdown instead of team numbers
    const brandNames = uniqSorted(state.dataRows.map(r => r["Brand Page"]));
    const teamSel = el("filterTeam");
    teamSel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = ""; allOpt.textContent = "All brands";
    teamSel.appendChild(allOpt);
    brandNames.forEach(b => {
      const o = document.createElement("option");
      o.value = b; o.textContent = b;
      teamSel.appendChild(o);
    });

    buildComparisonControls(state.dataRows);
    buildInfluenceControls(state.dataRows);

    setStatus(`${rows.length} rows loaded`);
    applyFilters();
  } catch (err) {
    console.error(err);
    setStatus("Error: " + (err?.message || String(err)));
  }
}

function init() {
  el("btnDownloadCsv").addEventListener("click", downloadFilteredCsv);
  el("btnClear").addEventListener("click", clearFilters);

  ["search", "filterClass", "filterPlatform", "filterTeam"].forEach(id => {
    el(id).addEventListener("input", applyFilters);
    el(id).addEventListener("change", applyFilters);
  });

  loadData();
}

document.addEventListener("DOMContentLoaded", init);
