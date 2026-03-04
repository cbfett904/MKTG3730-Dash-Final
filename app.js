/**
 * WMU MKTG 3730 Social Tracker
 * Data source: local ./data.json (generated from the class Excel).
 *
 * Features:
 * - Filter by Class, Team, Brand Page, Platform tab, Search
 * - Computes growth (delta + %) automatically when UP1/UP2 pairs exist
 * - Sortable table (click headers; Shift+click for secondary sort)
 * - Export filtered CSV
 */

const el = (id) => document.getElementById(id);

const state = {
  all: [],
  filtered: [],
  platform: "All",
  view: "summary",
  sorts: [], // [{key, dir}] dir: 1 asc, -1 desc
  meta: null,
  charts: { growth: null }
};

const prettyLabel = (key) => {
  // nicer table headers
  const map = {
    platform: "Platform",
    class: "Class",
    team: "Team",
    brand_page: "Brand Page",
    up1_followers: "UP1 Followers",
    up2_followers: "UP2 Followers",
    delta_followers: "Follower Growth",
    pct_followers: "Follower Growth %",
    fc_up1_fb: "FC UP1 Facebook",
    fc_up2_fb: "FC UP2 Facebook",
    fc_up1_ig: "FC UP1 Instagram",
    fc_up2_ig: "FC UP2 Instagram",
    fc_net_growth: "FC Net Growth",
    fc_total_fol_ct: "FC Total Followers"
  };
  if (map[key]) return map[key];

  // convert snake_case to Title Case
  return key
    .replace(/^up1_/, "UP1 ")
    .replace(/^up2_/, "UP2 ")
    .replace(/^delta_/, "Δ ")
    .replace(/^pct_/, "% ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function setStatus(msg) { el("status").textContent = msg; }

function uniq(arr) {
  return Array.from(new Set(arr.filter(v => v !== null && v !== undefined && String(v).trim() !== "")));
}

function fillSelect(selectEl, values, allLabel) {
  selectEl.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = allLabel;
  selectEl.appendChild(o0);

  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    selectEl.appendChild(o);
  });
}

function fmt(v, kind="auto") {
  if (v === null || v === undefined || v === "") return "";
  if (kind === "pct") {
    if (!isNum(v)) return "";
    return (v * 100).toFixed(1) + "%";
  }
  if (isNum(v)) return v.toLocaleString();
  return String(v);
}

function exportCsv(rows, keys) {
  const esc = (s) => {
    const t = String(s ?? "");
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g,'""') + '"' : t;
  };
  const lines = [];
  lines.push(keys.map(esc).join(","));
  for (const r of rows) lines.push(keys.map(k => esc(r[k])).join(","));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mktg3730_filtered.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function viewColumns(view, sample) {
  const base = ["class","team","brand_page","platform"];

  const summary = [
    "up1_followers","up2_followers","delta_followers","pct_followers",
    "up1_posts","up2_posts","delta_posts","pct_posts",
    "up1_views","up2_views","delta_views","pct_views",
    "up1_reach","up2_reach","delta_reach","pct_reach",
    "up1_interactions","up2_interactions","delta_interactions","pct_interactions"
  ];

  const growth = Object.keys(sample || {})
    .filter(k => k.startsWith("delta_") || k.startsWith("pct_"))
    .sort((a,b)=>a.localeCompare(b));

  const all = Object.keys(sample || {}).filter(k => !["source"].includes(k)).sort((a,b)=>a.localeCompare(b));

  if (view === "summary") {
    // include only columns that actually exist
    const keep = base.concat(summary).filter(k => k in (sample || {}));
    // also include follower count summary columns if present
    const extra = ["fc_up1_ig","fc_up2_ig","fc_up1_fb","fc_up2_fb","fc_net_growth","fc_total_fol_ct"].filter(k => k in (sample||{}));
    return keep.concat(extra);
  }
  if (view === "growth") return base.concat(growth);
  return base.concat(all.filter(k => !base.includes(k)));
}

function compare(a, b, key) {
  const va = a[key];
  const vb = b[key];

  // numeric first
  const na = isNum(va);
  const nb = isNum(vb);
  if (na && nb) return va - vb;

  // percent strings / nulls fallback
  const sa = (va === null || va === undefined) ? "" : String(va).toLowerCase();
  const sb = (vb === null || vb === undefined) ? "" : String(vb).toLowerCase();
  return sa.localeCompare(sb);
}

function applySort(rows) {
  if (!state.sorts.length) return rows;

  const sorts = state.sorts.slice();
  const out = rows.slice().sort((a,b) => {
    for (const s of sorts) {
      const c = compare(a,b,s.key);
      if (c !== 0) return c * s.dir;
    }
    return 0;
  });
  return out;
}

function renderTable() {
  const table = el("table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const rows = applySort(state.filtered);
  const sample = rows[0] || state.all[0] || {};
  const cols = viewColumns(state.view, sample);

  // header
  const trh = document.createElement("tr");
  cols.forEach((k) => {
    const th = document.createElement("th");
    th.textContent = prettyLabel(k) + sortGlyph(k);
    th.dataset.key = k;
    th.addEventListener("click", (e) => onHeaderClick(k, e.shiftKey));
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  // body
  for (const r of rows) {
    const tr = document.createElement("tr");
    cols.forEach((k) => {
      const td = document.createElement("td");
      const v = r[k];

      const isPct = k.startsWith("pct_");
      td.textContent = fmt(v, isPct ? "pct" : "auto");

      // subtle emphasis for growth
      if (k.startsWith("delta_") && isNum(v)) td.style.fontWeight = "800";
      if (k.startsWith("pct_") && isNum(v)) td.style.fontWeight = "800";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  el("chipRows").textContent = `${rows.length} rows`;
  el("sortedBy").textContent = state.sorts.length
    ? "Sorted by: " + state.sorts.map(s => `${prettyLabel(s.key)} ${s.dir === 1 ? "↑" : "↓"}`).join(", ")
    : "Sorted by: —";
}

function sortGlyph(key) {
  const s = state.sorts.find(x => x.key === key);
  if (!s) return "";
  return s.dir === 1 ? " ↑" : " ↓";
}

function onHeaderClick(key, isShift) {
  const existingIdx = state.sorts.findIndex(s => s.key === key);

  if (!isShift) {
    // single-sort mode
    if (existingIdx === -1) state.sorts = [{ key, dir: -1 }];
    else state.sorts = [{ key, dir: -state.sorts[existingIdx].dir }];
  } else {
    // multi-sort
    if (existingIdx === -1) state.sorts.push({ key, dir: -1 });
    else state.sorts[existingIdx].dir = -state.sorts[existingIdx].dir;
    // keep up to 2 sorts for sanity
    state.sorts = state.sorts.slice(0, 2);
  }
  renderTable();
}

function renderKpis() {
  const wrap = el("kpis");
  wrap.innerHTML = "";

  const rows = state.filtered;

  const sum = (key) => rows.reduce((acc,r) => acc + (isNum(r[key]) ? r[key] : 0), 0);

  const up1 = sum("up1_followers");
  const up2 = sum("up2_followers");
  const delta = sum("delta_followers");
  const pct = up1 ? (delta / up1) : null;

  const cards = [
    { label: "UP1 Followers", value: up1, note: "Starting follower count" },
    { label: "UP2 Followers", value: up2, note: "Ending follower count" },
    { label: "Growth (Δ)", value: delta, note: "UP2 − UP1" },
    { label: "Growth (%)", value: pct, note: "Δ / UP1" , kind:"pct" }
  ];

  for (const c of cards) {
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `
      <div class="kpi__label">${c.label}</div>
      <div class="kpi__value">${c.kind==="pct" ? fmt(c.value,"pct") : fmt(c.value)}</div>
      <div class="kpi__note">${c.note}</div>`;
    wrap.appendChild(div);
  }
}

function renderGrowthChart() {
  const rows = state.filtered;
  const byTeam = new Map();
  for (const r of rows) {
    const t = String(r.team || "Unknown");
    const d = isNum(r.delta_followers) ? r.delta_followers : 0;
    byTeam.set(t, (byTeam.get(t) || 0) + d);
  }

  const labels = Array.from(byTeam.keys()).sort((a,b)=>a.localeCompare(b));
  const values = labels.map(l => byTeam.get(l));

  const ctx = el("growthChart").getContext("2d");
  if (state.charts.growth) state.charts.growth.destroy();
  state.charts.growth = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Follower Growth (Δ)", data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function applyFilters() {
  const fClass = el("filterClass").value;
  const fTeam = el("filterTeam").value;
  const fBrand = el("filterBrand").value;
  const q = (el("search").value || "").trim().toLowerCase();

  const out = state.all.filter(r => {
    if (state.platform !== "All" && r.platform !== state.platform) return false;
    if (fClass && r.class !== fClass) return false;
    if (fTeam && r.team !== fTeam) return false;
    if (fBrand && r.brand_page !== fBrand) return false;

    if (q) {
      const hay = Object.values(r).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  state.filtered = out;

  renderKpis();
  renderGrowthChart();
  renderTable();
}

function setPlatformTab(p) {
  state.platform = p;
  document.querySelectorAll(".seg__btn").forEach(b => {
    b.classList.toggle("is-active", b.dataset.platform === p);
  });
  applyFilters();
}

function setView(v) {
  state.view = v;
  document.querySelectorAll(".pill").forEach(b => {
    b.classList.toggle("is-active", b.dataset.view === v);
  });
  renderTable();
}

async function loadData() {
  try {
    setStatus("Loading data.json…");
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
    const json = await res.json();
    state.meta = json.meta;
    state.all = (json.records || []).map(r => sanitizeRecord(r));

    // Build selects
    fillSelect(el("filterClass"), uniq(state.all.map(r => r.class)).sort(), "All classes");
    fillSelect(el("filterTeam"), uniq(state.all.map(r => r.team)).sort(), "All teams");
    fillSelect(el("filterBrand"), uniq(state.all.map(r => r.brand_page)).sort(), "All brand pages");

    el("updatedAt").textContent = state.meta?.generated_at ? `Data generated: ${state.meta.generated_at}` : "—";

    // default sort by class then team then brand
    state.sorts = [{ key: "class", dir: 1 }, { key: "team", dir: 1 }];

    setStatus(`Loaded ${state.all.length} rows from Excel. Choose filters above.`);
    applyFilters();
  } catch (e) {
    console.error(e);
    setStatus("Error: " + (e?.message || String(e)));
  }
}

function sanitizeRecord(r) {
  // Ensure numeric fields are numbers (not strings) where possible
  const out = { ...r };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === "string") {
      const s = v.replace(/,/g,"").trim();
      if (s !== "" && /^-?\d+(\.\d+)?$/.test(s)) out[k] = Number(s);
    }
  }

  // If delta/pct are missing but UP1/UP2 exist, compute them for every UP pair.
  const keys = Object.keys(out);
  for (const k of keys) {
    const m1 = k.match(/^up1_(.+)$/);
    if (!m1) continue;
    const metric = m1[1];
    const k2 = "up2_" + metric;
    if (!(k2 in out)) continue;

    const v1 = out[k];
    const v2 = out[k2];
    if (isNum(v1) && isNum(v2)) {
      const dk = "delta_" + metric;
      const pk = "pct_" + metric;
      if (!(dk in out)) out[dk] = v2 - v1;
      if (!(pk in out)) out[pk] = v1 !== 0 ? (v2 - v1) / v1 : null;
    }
  }
  return out;
}

function wireUI() {
  // Platform tabs
  document.querySelectorAll(".seg__btn").forEach(btn => {
    btn.addEventListener("click", () => setPlatformTab(btn.dataset.platform));
  });

  // View pills
  document.querySelectorAll(".pill").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  // Filters
  ["filterClass","filterTeam","filterBrand"].forEach(id => el(id).addEventListener("change", applyFilters));
  el("search").addEventListener("input", applyFilters);

  // Buttons
  el("btnReset").addEventListener("click", () => {
    el("filterClass").value = "";
    el("filterTeam").value = "";
    el("filterBrand").value = "";
    el("search").value = "";
    state.sorts = [{ key: "class", dir: 1 }, { key: "team", dir: 1 }];
    setPlatformTab("All");
    setView("summary");
    applyFilters();
  });

  el("btnExport").addEventListener("click", () => {
    const sample = state.filtered[0] || state.all[0] || {};
    const cols = viewColumns(state.view, sample);
    exportCsv(applySort(state.filtered), cols);
  });

  el("btnRefresh").addEventListener("click", loadData);
}

document.addEventListener("DOMContentLoaded", () => {
  wireUI();
  loadData();
});
