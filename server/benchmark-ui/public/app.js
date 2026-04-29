// Benchmark Analytics — vanilla client. No build step.
const $ = (sel) => document.querySelector(sel);
const fmtPct = (v) => (v == null || isNaN(v) ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
const fmtUsd = (v) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const fmtMs = (v) => {
  if (v == null) return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—";
  if (n >= 60000) return `${(n / 60000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
};
const fmtInt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: "#8a93a0", font: { size: 11 } } },
    tooltip: { backgroundColor: "#14171c", borderColor: "#1f242c", borderWidth: 1, titleColor: "#e5e7eb", bodyColor: "#e5e7eb" },
  },
  scales: {
    x: { ticks: { color: "#545c68", font: { size: 10 } }, grid: { color: "#1f242c" } },
    y: { ticks: { color: "#545c68", font: { size: 10 } }, grid: { color: "#1f242c" } },
  },
};

const charts = {};

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

function setKpi(id, value, tone) {
  const el = $("#" + id);
  el.textContent = value;
  el.classList.remove("good", "bad", "warn");
  if (tone) el.classList.add(tone);
}

function renderBarBreakdown(canvasId, rows) {
  if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
  const canvas = document.getElementById(canvasId);
  const parent = canvas.parentElement;
  // Clear any prior empty-state overlay.
  const prior = parent.querySelector(".empty-state");
  if (prior) prior.remove();
  canvas.style.display = "";
  if (!rows || rows.length === 0) {
    canvas.style.display = "none";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No results for this run yet.";
    empty.style.cssText = "color:var(--text-dim);font-size:12px;text-align:center;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;";
    parent.appendChild(empty);
    return;
  }
  const labels = rows.map((r) => r.label);
  const passRates = rows.map((r) => (r.total > 0 ? (r.passed / r.total) * 100 : 0));
  const totals = rows.map((r) => r.total);
  charts[canvasId] = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Pass rate %",
          data: passRates,
          backgroundColor: passRates.map((p) => (p >= 85 ? "#4ade80" : p >= 70 ? "#facc15" : "#f87171")),
          borderWidth: 0,
          yAxisID: "y",
        },
        {
          label: "Total",
          data: totals,
          type: "line",
          borderColor: "#6b8de3",
          backgroundColor: "#6b8de3",
          pointRadius: 2,
          tension: 0.2,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      ...CHART_BASE,
      scales: {
        x: CHART_BASE.scales.x,
        y: { ...CHART_BASE.scales.y, min: 0, max: 100, ticks: { ...CHART_BASE.scales.y.ticks, callback: (v) => `${v}%` } },
        y1: { ...CHART_BASE.scales.y, position: "right", grid: { display: false } },
      },
    },
  });
}

function renderFailureBuckets(rows) {
  const tbody = $("#failure-buckets tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim)">No failures in this run.</td></tr>';
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.bucket}</td><td class="num">${fmtInt(r.count)}</td><td class="num">${r.avg_score != null ? r.avg_score.toFixed(2) : "—"}</td>`;
    tbody.appendChild(tr);
  }
}

function renderFailures(rows) {
  const tbody = $("#failures tbody");
  tbody.innerHTML = "";
  $("#failures-count").textContent = rows.length ? `(${rows.length} shown)` : "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-dim)">No failures.</td></tr>';
    return;
  }
  for (const r of rows) {
    const c = r.case || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.protocol || "—")}</td>
      <td>${escapeHtml(c.metricType || "—")}</td>
      <td class="query" title="${escapeAttr(c.naturalLanguageQuery || "")}">${escapeHtml(c.naturalLanguageQuery || "")}</td>
      <td class="num">${r.score != null ? Number(r.score).toFixed(2) : "—"}</td>
      <td class="num">${r.mape != null ? (Number(r.mape) * 100).toFixed(1) + "%" : "—"}</td>
      <td>${escapeHtml(r.dataSource || "—")}</td>
      <td class="err" title="${escapeAttr(r.errorMessage || "")}">${escapeHtml(r.errorMessage || "")}</td>
    `;
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, " "); }

async function renderHistory() {
  const history = await fetchJson("/api/history");
  // Drop aborted / in-flight runs from the trend line — they plot as 0%
  // and make the shape of the series look like noise.
  const completed = history.filter(
    (r) => r.status === "completed" && r.passedCases > 0,
  );
  // Short x-axis labels: just "vNN". Date goes in the tooltip so the
  // axis stays readable even across 50+ runs.
  const labels = completed.map((r) => `v${r.configVersion}`);
  const tooltipDates = completed.map((r) => fmtDate(r.createdAt));
  const acc = completed.map((r) => (r.overallAccuracy != null ? Number(r.overallAccuracy) * 100 : null));
  const cost = completed.map((r) => (r.totalCostUsd != null ? Number(r.totalCostUsd) : null));
  if (charts.history) charts.history.destroy();
  charts.history = new Chart(document.getElementById("chart-history"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Accuracy %", data: acc, borderColor: "#6b8de3", backgroundColor: "#6b8de3", tension: 0.25, pointRadius: 3, yAxisID: "y" },
        { label: "Cost $", data: cost, borderColor: "#facc15", backgroundColor: "#facc15", tension: 0.25, pointRadius: 2, borderDash: [4, 4], yAxisID: "y1" },
      ],
    },
    options: {
      ...CHART_BASE,
      plugins: {
        ...CHART_BASE.plugins,
        tooltip: {
          ...CHART_BASE.plugins.tooltip,
          callbacks: {
            title: (items) => {
              const i = items?.[0]?.dataIndex ?? 0;
              return `${labels[i]} · ${tooltipDates[i] || ""}`;
            },
          },
        },
      },
      scales: {
        x: {
          ...CHART_BASE.scales.x,
          ticks: {
            ...CHART_BASE.scales.x.ticks,
            autoSkip: true,
            maxRotation: 0,
            minRotation: 0,
            maxTicksLimit: 14,
          },
        },
        y: { ...CHART_BASE.scales.y, min: 0, max: 100, ticks: { ...CHART_BASE.scales.y.ticks, callback: (v) => `${v}%` } },
        y1: { ...CHART_BASE.scales.y, position: "right", grid: { display: false }, ticks: { ...CHART_BASE.scales.y.ticks, callback: (v) => `$${v}` } },
      },
    },
  });
}

async function loadRun(runId) {
  const [breakdown, failureBuckets, failures] = await Promise.all([
    fetchJson(`/api/runs/${runId}/breakdown`),
    fetchJson(`/api/runs/${runId}/failure-buckets`),
    fetchJson(`/api/runs/${runId}/results?failed=1&limit=200`),
  ]);

  const { run, byCategory, byDifficulty, bySource, latency } = breakdown;

  // While a run is still in flight, `benchmark_runs` holds zeros for
  // passed/accuracy (those fields get written at completion). Derive a
  // live tally from the per-category rollup so the summary matches what
  // the breakdown charts already show.
  const isRunning = run.status === "running";
  const liveTotal = byCategory.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const livePassed = byCategory.reduce((sum, r) => sum + Number(r.passed || 0), 0);
  const liveAccuracy = liveTotal > 0 ? livePassed / liveTotal : 0;

  const effectiveTotal = isRunning ? liveTotal : Number(run.totalCases || 0);
  const effectivePassed = isRunning ? livePassed : Number(run.passedCases || 0);
  const accVal =
    isRunning ? liveAccuracy * 100 : Number(run.overallAccuracy || 0) * 100;

  setKpi("k-version", `v${run.configVersion}`);
  setKpi("k-accuracy", `${accVal.toFixed(1)}%`, accVal >= 85 ? "good" : accVal >= 70 ? "warn" : "bad");
  const passedLabel = isRunning
    ? `${fmtInt(effectivePassed)} / ${fmtInt(run.totalCases)} (live)`
    : `${fmtInt(effectivePassed)} / ${fmtInt(effectiveTotal)}`;
  setKpi("k-passed", passedLabel);
  setKpi("k-cost", fmtUsd(run.totalCostUsd));
  setKpi(
    "k-latency",
    latency && latency.p50 != null
      ? `${fmtMs(latency.p50)} · ${fmtMs(latency.p90)}`
      : "—",
  );
  setKpi("k-status", run.status, run.status === "completed" ? "good" : run.status === "running" ? "warn" : "bad");

  renderBarBreakdown("chart-category", byCategory);
  renderBarBreakdown("chart-difficulty", byDifficulty);
  renderBarBreakdown("chart-source", bySource);
  renderFailureBuckets(failureBuckets);
  renderFailures(failures);
}

async function boot() {
  const runs = await fetchJson("/api/runs");
  const select = $("#run-select");
  select.innerHTML = "";
  if (!runs.length) {
    select.innerHTML = '<option value="">No runs yet</option>';
    return;
  }
  for (const r of runs) {
    const opt = document.createElement("option");
    opt.value = r.id;
    const acc = r.overallAccuracy != null ? ` · ${(Number(r.overallAccuracy) * 100).toFixed(1)}%` : "";
    opt.textContent = `v${r.configVersion} · ${fmtDate(r.createdAt)}${acc} · ${r.status}`;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => loadRun(select.value));
  await renderHistory();
  // Default to the most recent run with real data. Aborted / in-flight
  // runs have no case_results, so every breakdown renders as empty and
  // the page looks broken on first load.
  const defaultRun =
    runs.find((r) => r.status === "completed" && r.passedCases > 0) || runs[0];
  select.value = defaultRun.id;
  await loadRun(defaultRun.id);
}

// ───────────────── Quality mode ─────────────────

let qualityRuns = [];

function fmtDuration(ms) {
  if (ms == null) return "—";
  const n = Number(ms);
  if (n >= 60000) return `${(n / 60000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

function renderQualityBars(canvasId, rows, scoreMax = 5) {
  if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
  const canvas = document.getElementById(canvasId);
  const parent = canvas.parentElement;
  const prior = parent.querySelector(".empty-state");
  if (prior) prior.remove();
  canvas.style.display = "";
  if (!rows || rows.length === 0) {
    canvas.style.display = "none";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No results yet.";
    empty.style.cssText = "color:var(--text-dim);font-size:12px;text-align:center;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;";
    parent.appendChild(empty);
    return;
  }
  const labels = rows.map(r => r.label);
  const avg = rows.map(r => (r.avg_score != null ? Number(r.avg_score) : 0));
  const totals = rows.map(r => r.total);
  charts[canvasId] = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Avg score",
          data: avg,
          backgroundColor: avg.map(s => (s >= 4 ? "#4ade80" : s >= 2 ? "#facc15" : "#f87171")),
          borderWidth: 0,
          yAxisID: "y",
        },
        {
          label: "Total",
          data: totals,
          type: "line",
          borderColor: "#6b8de3",
          backgroundColor: "#6b8de3",
          pointRadius: 2,
          tension: 0.2,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      ...CHART_BASE,
      scales: {
        x: CHART_BASE.scales.x,
        y: { ...CHART_BASE.scales.y, min: 0, max: scoreMax, ticks: { ...CHART_BASE.scales.y.ticks, callback: v => `${v}` } },
        y1: { ...CHART_BASE.scales.y, position: "right", grid: { display: false } },
      },
    },
  });
}

// Track which rows are expanded so auto-refresh doesn't collapse them.
const expandedQualityRows = new Set();

function fmtLatencyMs(ms) {
  if (ms == null) return "—";
  const n = Number(ms);
  if (n >= 60000) return `${(n / 60000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

function renderQualityDetailRow(r) {
  const c = r.case || {};
  const tags = Array.isArray(c.tags) ? c.tags : [];
  const priorTurns = Array.isArray(c.priorTurns) ? c.priorTurns : [];
  const artifacts = Array.isArray(r.responseArtifacts) ? r.responseArtifacts : [];
  const responseText = (r.responseText || "").trim();

  const priorTurnsHtml = priorTurns.length
    ? priorTurns.map(t => `
        <div class="q-prior-turn">
          <div class="q-prior-role">${escapeHtml(String(t.role || "").toLowerCase())}</div>
          <div>${escapeHtml(String(t.content || ""))}</div>
        </div>`).join("")
    : `<span class="q-val muted">No prior turns (single-turn case).</span>`;

  return `
    <div class="q-detail">
      <div class="q-label">Full prompt</div>
      <div class="q-val">${escapeHtml(c.prompt || "")}</div>

      <div class="q-label">Expected behavior</div>
      <div class="q-val muted">${escapeHtml(c.expectedBehavior || "—")}</div>

      <div class="q-label">Tags</div>
      <div class="q-val mono">${tags.length ? tags.map(escapeHtml).join(" · ") : "—"}</div>

      <div class="q-label">Prior conversation</div>
      <div class="q-val">${priorTurnsHtml}</div>

      <div class="q-label">Critique (full)</div>
      <div class="q-val">${escapeHtml(r.critique || "—")}</div>

      <div class="q-label">Response text (excerpt)</div>
      <div class="q-val"><pre>${escapeHtml(responseText.slice(0, 4000) || "(empty)")}${responseText.length > 4000 ? "\n\n…[truncated]" : ""}</pre></div>

      <div class="q-label">Artifacts (${artifacts.length})</div>
      <div class="q-val">${artifacts.length ? `<pre>${escapeHtml(JSON.stringify(artifacts, null, 2).slice(0, 4000))}</pre>` : '<span class="muted">none</span>'}</div>

      ${r.errorMessage ? `
      <div class="q-label">Error</div>
      <div class="q-val error">${escapeHtml(r.errorMessage)}</div>` : ""}

      <div class="q-label">Cost / Latency</div>
      <div class="q-val mono">${fmtUsd(r.costUsd)} · ${fmtLatencyMs(r.latencyMs)}</div>
    </div>
  `;
}

function renderQualityResults(rows) {
  const tbody = $("#q-results tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text-dim)">No per-case results.</td></tr>';
    return;
  }
  // Re-render rows preserving expanded state by case id.
  for (const r of rows) {
    const c = r.case || {};
    const verdict = (r.verdict || "fail").toLowerCase();
    const isExpanded = expandedQualityRows.has(r.id);
    const tr = document.createElement("tr");
    tr.className = "q-row" + (isExpanded ? " expanded" : "");
    tr.dataset.resultId = r.id;
    tr.innerHTML = `
      <td class="q-toggle">${isExpanded ? "▾" : "▸"}</td>
      <td>${escapeHtml(r.dimension || "—")}</td>
      <td class="query" title="${escapeAttr(c.prompt || "")}">${escapeHtml(c.prompt || "")}</td>
      <td class="num">${r.score != null ? Number(r.score).toFixed(1) : "—"}</td>
      <td><span class="verdict-pill ${verdict}">${escapeHtml(verdict)}</span></td>
      <td class="num">${fmtUsd(r.costUsd)}</td>
      <td class="num">${fmtLatencyMs(r.latencyMs)}</td>
      <td class="query" title="${escapeAttr(r.critique || "")}">${escapeHtml(r.critique || "")}</td>
    `;
    tr.addEventListener("click", () => {
      const id = r.id;
      if (expandedQualityRows.has(id)) expandedQualityRows.delete(id);
      else expandedQualityRows.add(id);
      renderQualityResults(rows);
    });
    tbody.appendChild(tr);
    if (isExpanded) {
      const detail = document.createElement("tr");
      detail.className = "q-detail-row";
      const td = document.createElement("td");
      td.colSpan = 8;
      td.innerHTML = renderQualityDetailRow(r);
      detail.appendChild(td);
      tbody.appendChild(detail);
    }
  }
}

let qualityCurrentRunStatus = null;

async function loadQualityRun(runId) {
  const [detail, results, criterionMisses] = await Promise.all([
    fetchJson(`/api/quality-runs/${runId}`),
    fetchJson(`/api/quality-runs/${runId}/results`),
    fetchJson(`/api/quality-runs/${runId}/criterion-misses`).catch(() => []),
  ]);
  const { run, byDimension, byVerdict } = detail;
  qualityCurrentRunStatus = run.status;

  $("#q-when").textContent = fmtDate(run.createdAt);
  const avg = run.averageScore != null ? Number(run.averageScore) : null;
  $("#q-avg").textContent = avg != null ? `${avg.toFixed(2)} / 5` : "—";
  $("#q-avg").className = `v ${avg != null && avg >= 4 ? "good" : avg != null && avg >= 2 ? "warn" : "bad"}`;
  $("#q-scored").textContent = `${fmtInt(run.scoredCases)} / ${fmtInt(run.totalCases)}`;
  $("#q-cost").textContent = fmtUsd(run.totalCostUsd);
  $("#q-duration").textContent = fmtDuration(run.totalLatencyMs);
  $("#q-status").textContent = run.status;
  $("#q-status").className = `v ${run.status === "completed" ? "good" : run.status === "running" ? "warn" : "bad"}`;
  $("#q-notes").textContent = run.notes || "—";

  renderQualityBars("q-chart-dim", byDimension);
  renderQualityBars("q-chart-verdict", byVerdict);
  renderCriterionMisses(criterionMisses);
  renderQualityResults(results);
}

function renderCriterionMisses(rows) {
  const tbody = $("#q-criterion-misses tbody");
  tbody.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="muted" style="padding:14px;text-align:center;">No structured criteria scored on this run yet — cases without a populated criteria array still grade against the freeform rubric only.</td>`;
    tbody.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    const dims = (Array.isArray(r.dimensions) ? r.dimensions : []).map(d => `<span class="dim-pill">${escapeHtml(d)}</span>`).join(" ");
    tr.innerHTML = `
      <td><code class="criterion-id">${escapeHtml(r.criterion_id || "")}</code></td>
      <td class="prompt-cell">${escapeHtml(r.description || "")}</td>
      <td>${dims || '<span class="muted">—</span>'}</td>
      <td class="num bad">${fmtInt(r.fail_count)}</td>
      <td class="num">${r.avg_case_score != null ? Number(r.avg_case_score).toFixed(2) : "—"}</td>
    `;
    tbody.appendChild(tr);
  }
}

function repopulateRunSelect(runs) {
  const select = $("#run-select");
  const preserved = select.value;
  select.innerHTML = "";
  for (const r of runs) {
    const opt = document.createElement("option");
    opt.value = r.id;
    const avg = r.averageScore != null ? ` · ${Number(r.averageScore).toFixed(2)}/5` : "";
    opt.textContent = `${fmtDate(r.createdAt)}${avg} · ${r.status} · ${r.scoredCases}/${r.totalCases}`;
    select.appendChild(opt);
  }
  if (preserved && runs.some(r => r.id === preserved)) select.value = preserved;
}

let qualityPollTimer = null;

function stopQualityPolling() {
  if (qualityPollTimer) {
    clearTimeout(qualityPollTimer);
    qualityPollTimer = null;
  }
}

function startQualityPolling() {
  stopQualityPolling();
  const tick = async () => {
    qualityPollTimer = null;
    try {
      const fresh = await fetchJson("/api/quality-runs");
      // Repopulate dropdown only if the list changed (avoids stomping the open dropdown).
      const changed =
        fresh.length !== qualityRuns.length ||
        fresh.some((r, i) => r.id !== qualityRuns[i]?.id || r.status !== qualityRuns[i]?.status || r.scoredCases !== qualityRuns[i]?.scoredCases);
      if (changed) {
        qualityRuns = fresh;
        repopulateRunSelect(qualityRuns);
      }
      const select = $("#run-select");
      if (select.value) await loadQualityRun(select.value);
    } catch (e) {
      console.warn("[quality poll]", e?.message || e);
    }
    // Adaptive cadence: 5s while a run is active, 30s otherwise.
    const ms = qualityCurrentRunStatus === "running" ? 5000 : 30000;
    qualityPollTimer = setTimeout(tick, ms);
  };
  qualityPollTimer = setTimeout(tick, 5000);
}

async function bootQuality() {
  qualityRuns = await fetchJson("/api/quality-runs");
  const select = $("#run-select");
  select.innerHTML = "";
  if (!qualityRuns.length) {
    select.innerHTML = '<option value="">No quality runs yet — run `npm run benchmark -- quality-run`</option>';
    $("#q-avg").textContent = "—";
    $("#q-scored").textContent = "—";
    $("#q-status").textContent = "—";
    startQualityPolling();
    return;
  }
  repopulateRunSelect(qualityRuns);
  select.onchange = () => loadQualityRun(select.value);
  await loadQualityRun(qualityRuns[0].id);
  startQualityPolling();
}

function switchMode(mode) {
  const isCrossRun = mode === "costs" || mode === "latency" || mode === "outputs";
  $("#mode-tolerance").classList.toggle("active", mode === "tolerance");
  $("#mode-quality").classList.toggle("active", mode === "quality");
  $("#mode-costs").classList.toggle("active", mode === "costs");
  $("#mode-latency").classList.toggle("active", mode === "latency");
  $("#mode-outputs").classList.toggle("active", mode === "outputs");
  $("#view-tolerance").hidden = mode !== "tolerance";
  $("#view-quality").hidden = mode !== "quality";
  $("#view-costs").hidden = mode !== "costs";
  $("#view-latency").hidden = mode !== "latency";
  $("#view-outputs").hidden = mode !== "outputs";
  // Run picker is per-run; cross-run views hide it.
  $("#run-picker-wrap").hidden = isCrossRun;

  // Re-wire the run picker for the new mode (no-op for cross-run views).
  if (!isCrossRun) {
    const select = $("#run-select");
    const newSelect = select.cloneNode(false);
    select.parentNode.replaceChild(newSelect, select);
  }

  if (mode === "tolerance") {
    stopQualityPolling();
    boot().catch(err => console.error(err));
  } else if (mode === "quality") {
    bootQuality().catch(err => console.error(err));
  } else if (mode === "costs") {
    stopQualityPolling();
    bootCosts().catch(err => console.error(err));
  } else if (mode === "latency") {
    stopQualityPolling();
    bootLatency().catch(err => console.error(err));
  } else {
    stopQualityPolling();
    bootOutputs().catch(err => console.error(err));
  }
}

// ─────────── Costs view (cross-run cost analytics) ───────────

let costData = null;

async function bootCosts() {
  costData = await fetchJson("/api/cost-analytics");
  renderCostKpis(costData.totals);
  renderCostRunTrend(costData.runs);
  renderCostByDimension(costData.byDimension);
  populateDimensionFilter(costData.byDimension);
  renderCostPromptTable();

  $("#c-sort").onchange = renderCostPromptTable;
  $("#c-dim-filter").onchange = renderCostPromptTable;
}

function renderCostKpis(t) {
  $("#c-total").textContent = fmtUsd(t.total_cost);
  $("#c-cases").textContent = fmtInt(t.total_cases);
  $("#c-avg").textContent = fmtUsd(t.avg_cost);
  $("#c-prompts").textContent = fmtInt(t.unique_prompts);
  $("#c-runs").textContent = fmtInt(t.total_runs);
}

function renderCostRunTrend(runs) {
  const id = "c-chart-runs";
  if (charts[id]) { charts[id].destroy(); charts[id] = null; }
  const labels = runs.map(r => fmtDate(r.created_at));
  const totals = runs.map(r => (r.total_cost_usd != null ? Number(r.total_cost_usd) : null));
  const perCase = runs.map(r => (r.avg_cost_per_case != null ? Number(r.avg_cost_per_case) : null));
  charts[id] = new Chart(document.getElementById(id), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Total $", data: totals, borderColor: "#facc15", backgroundColor: "#facc15", tension: 0.25, pointRadius: 3, yAxisID: "y" },
        { label: "Avg $ / case", data: perCase, borderColor: "#6b8de3", backgroundColor: "#6b8de3", tension: 0.25, pointRadius: 2, borderDash: [4, 4], yAxisID: "y1" },
      ],
    },
    options: {
      ...CHART_BASE,
      scales: {
        x: CHART_BASE.scales.x,
        y:  { ...CHART_BASE.scales.y, title: { display: true, text: "Total $", color: "#8a93a0", font: { size: 10 } } },
        y1: { ...CHART_BASE.scales.y, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "$ / case", color: "#8a93a0", font: { size: 10 } } },
      },
    },
  });
}

function renderCostByDimension(rows) {
  const id = "c-chart-dim";
  if (charts[id]) { charts[id].destroy(); charts[id] = null; }
  const sorted = [...rows].sort((a, b) => Number(b.avg_cost ?? 0) - Number(a.avg_cost ?? 0));
  charts[id] = new Chart(document.getElementById(id), {
    type: "bar",
    data: {
      labels: sorted.map(r => r.label),
      datasets: [{
        label: "Avg $ / case",
        data: sorted.map(r => Number(r.avg_cost ?? 0)),
        backgroundColor: "#6b8de3",
      }],
    },
    options: {
      ...CHART_BASE,
      indexAxis: "y",
      plugins: {
        ...CHART_BASE.plugins,
        legend: { display: false },
        tooltip: {
          ...CHART_BASE.plugins.tooltip,
          callbacks: {
            label: (ctx) => {
              const row = sorted[ctx.dataIndex];
              const avg = Number(row.avg_cost ?? 0);
              const total = Number(row.total_cost ?? 0);
              const cases = Number(row.total_cases ?? 0);
              return [
                `Avg: $${avg.toFixed(2)} / case`,
                `Total: $${total.toFixed(2)} across ${cases} case${cases === 1 ? "" : "s"}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, callback: (v) => `$${Number(v).toFixed(0)}` } },
        y: CHART_BASE.scales.y,
      },
    },
  });
}

function populateDimensionFilter(rows) {
  const sel = $("#c-dim-filter");
  const current = sel.value;
  sel.innerHTML = '<option value="">All</option>';
  for (const r of rows) {
    const opt = document.createElement("option");
    opt.value = r.label;
    opt.textContent = `${r.label} (${r.total_cases})`;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

function renderCostPromptTable() {
  if (!costData) return;
  const tbody = $("#c-prompt-table tbody");
  tbody.innerHTML = "";
  const dimFilter = $("#c-dim-filter").value;
  const sortMode = $("#c-sort").value;

  // Decorate each row with first/last/delta we actually need for sort + render.
  const decorated = costData.byPrompt
    .filter(r => !dimFilter || r.dimension === dimFilter)
    .map(r => {
      const runs = (r.runs || []).filter(x => x.costUsd != null);
      const first = runs[0]?.costUsd ?? null;
      const last = runs[runs.length - 1]?.costUsd ?? null;
      const deltaPct = (first != null && last != null && first > 0) ? ((last - first) / first) * 100 : null;
      return { ...r, first, last, deltaPct, runs };
    });

  decorated.sort((a, b) => {
    if (sortMode === "movement") {
      const av = a.deltaPct == null ? -Infinity : Math.abs(a.deltaPct);
      const bv = b.deltaPct == null ? -Infinity : Math.abs(b.deltaPct);
      return bv - av;
    }
    if (sortMode === "avg-desc") return Number(b.avg_cost ?? 0) - Number(a.avg_cost ?? 0);
    if (sortMode === "avg-asc")  return Number(a.avg_cost ?? 0) - Number(b.avg_cost ?? 0);
    return Number(b.run_count ?? 0) - Number(a.run_count ?? 0);
  });

  $("#c-prompt-count").textContent = `${decorated.length} prompt${decorated.length === 1 ? "" : "s"}`;

  for (const r of decorated) {
    const tr = document.createElement("tr");
    const deltaCell = r.deltaPct == null
      ? `<td class="num muted">—</td>`
      : `<td class="num ${r.deltaPct < 0 ? "good" : r.deltaPct > 0 ? "bad" : ""}">${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(0)}%</td>`;
    const trail = r.runs.map(rn => {
      const cls = rn.verdict === "pass" ? "pass" : rn.verdict === "fail" ? "fail" : "partial";
      const tip = `${fmtDate(rn.createdAt)} · ${fmtUsd(rn.costUsd)} · score ${rn.score?.toFixed?.(1) ?? "—"} · ${rn.verdict ?? "—"}`;
      return `<span class="cost-pip ${cls}" title="${escapeHtml(tip)}">${fmtUsd(rn.costUsd)}</span>`;
    }).join(" ");
    tr.innerHTML = `
      <td><span class="dim-pill">${escapeHtml(r.dimension)}</span></td>
      <td class="prompt-cell">${escapeHtml(truncate(r.prompt, 110))}</td>
      <td class="num">${fmtInt(r.run_count)}</td>
      <td class="num">${fmtUsd(r.first)}</td>
      <td class="num">${fmtUsd(r.last)}</td>
      ${deltaCell}
      <td class="num">${fmtUsd(r.avg_cost)}</td>
      <td class="num muted">${fmtUsd(r.min_cost)}</td>
      <td class="num muted">${fmtUsd(r.max_cost)}</td>
      <td class="trail-cell">${trail || '<span class="muted">—</span>'}</td>
    `;
    tbody.appendChild(tr);
  }
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ─────────── Latency view (cross-run latency analytics) ───────────

let latencyData = null;

async function bootLatency() {
  latencyData = await fetchJson("/api/latency-analytics");
  renderLatencyKpis(latencyData.totals);
  renderLatencyRunTrend(latencyData.runs);
  renderLatencyByDimension(latencyData.byDimension);
  populateLatencyDimFilter(latencyData.byDimension);
  renderLatencyPromptTable();

  $("#l-sort").onchange = renderLatencyPromptTable;
  $("#l-dim-filter").onchange = renderLatencyPromptTable;
}

function renderLatencyKpis(t) {
  $("#l-total").textContent = fmtMs(t.total_ms);
  $("#l-cases").textContent = fmtInt(t.total_cases);
  $("#l-avg").textContent = fmtMs(t.avg_ms);
  $("#l-p50p90").textContent = `${fmtMs(t.p50_ms)} · ${fmtMs(t.p90_ms)}`;
  $("#l-p99").textContent = fmtMs(t.p99_ms);
}

function renderLatencyRunTrend(runs) {
  const id = "l-chart-runs";
  if (charts[id]) { charts[id].destroy(); charts[id] = null; }
  const labels = runs.map(r => fmtDate(r.created_at));
  const avg = runs.map(r => (r.avg_latency_per_case != null ? Number(r.avg_latency_per_case) : null));
  const p50 = runs.map(r => (r.p50_ms != null ? Number(r.p50_ms) : null));
  const p90 = runs.map(r => (r.p90_ms != null ? Number(r.p90_ms) : null));
  charts[id] = new Chart(document.getElementById(id), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Avg",  data: avg, borderColor: "#6b8de3", backgroundColor: "#6b8de3", tension: 0.25, pointRadius: 3 },
        { label: "p50",  data: p50, borderColor: "#4ade80", backgroundColor: "#4ade80", tension: 0.25, pointRadius: 2, borderDash: [4, 4] },
        { label: "p90",  data: p90, borderColor: "#facc15", backgroundColor: "#facc15", tension: 0.25, pointRadius: 2, borderDash: [4, 4] },
      ],
    },
    options: {
      ...CHART_BASE,
      plugins: {
        ...CHART_BASE.plugins,
        tooltip: {
          ...CHART_BASE.plugins.tooltip,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMs(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: CHART_BASE.scales.x,
        y: { ...CHART_BASE.scales.y, ticks: { ...CHART_BASE.scales.y.ticks, callback: (v) => fmtMs(v) } },
      },
    },
  });
}

function renderLatencyByDimension(rows) {
  const id = "l-chart-dim";
  if (charts[id]) { charts[id].destroy(); charts[id] = null; }
  const sorted = [...rows].sort((a, b) => Number(b.avg_ms ?? 0) - Number(a.avg_ms ?? 0));
  charts[id] = new Chart(document.getElementById(id), {
    type: "bar",
    data: {
      labels: sorted.map(r => r.label),
      datasets: [{
        label: "Avg / case",
        data: sorted.map(r => Number(r.avg_ms ?? 0)),
        backgroundColor: "#6b8de3",
      }],
    },
    options: {
      ...CHART_BASE,
      indexAxis: "y",
      plugins: {
        ...CHART_BASE.plugins,
        legend: { display: false },
        tooltip: {
          ...CHART_BASE.plugins.tooltip,
          callbacks: {
            label: (ctx) => {
              const row = sorted[ctx.dataIndex];
              const cases = Number(row.total_cases ?? 0);
              return [
                `Avg: ${fmtMs(row.avg_ms)} / case`,
                `p90: ${fmtMs(row.p90_ms)}`,
                `Total: ${fmtMs(row.total_ms)} across ${cases} case${cases === 1 ? "" : "s"}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, callback: (v) => fmtMs(v) } },
        y: CHART_BASE.scales.y,
      },
    },
  });
}

function populateLatencyDimFilter(rows) {
  const sel = $("#l-dim-filter");
  const current = sel.value;
  sel.innerHTML = '<option value="">All</option>';
  for (const r of rows) {
    const opt = document.createElement("option");
    opt.value = r.label;
    opt.textContent = `${r.label} (${r.total_cases})`;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

function renderLatencyPromptTable() {
  if (!latencyData) return;
  const tbody = $("#l-prompt-table tbody");
  tbody.innerHTML = "";
  const dimFilter = $("#l-dim-filter").value;
  const sortMode = $("#l-sort").value;

  const decorated = latencyData.byPrompt
    .filter(r => !dimFilter || r.dimension === dimFilter)
    .map(r => {
      const runs = (r.runs || []).filter(x => x.latencyMs != null);
      const first = runs[0]?.latencyMs ?? null;
      const last = runs[runs.length - 1]?.latencyMs ?? null;
      const deltaPct = (first != null && last != null && first > 0) ? ((last - first) / first) * 100 : null;
      return { ...r, first, last, deltaPct, runs };
    });

  decorated.sort((a, b) => {
    if (sortMode === "movement") {
      const av = a.deltaPct == null ? -Infinity : Math.abs(a.deltaPct);
      const bv = b.deltaPct == null ? -Infinity : Math.abs(b.deltaPct);
      return bv - av;
    }
    if (sortMode === "avg-desc") return Number(b.avg_ms ?? 0) - Number(a.avg_ms ?? 0);
    if (sortMode === "avg-asc")  return Number(a.avg_ms ?? 0) - Number(b.avg_ms ?? 0);
    return Number(b.run_count ?? 0) - Number(a.run_count ?? 0);
  });

  $("#l-prompt-count").textContent = `${decorated.length} prompt${decorated.length === 1 ? "" : "s"}`;

  for (const r of decorated) {
    const tr = document.createElement("tr");
    // For latency, "good" = lower (got faster), so color flips vs cost view.
    const deltaCell = r.deltaPct == null
      ? `<td class="num muted">—</td>`
      : `<td class="num ${r.deltaPct < 0 ? "good" : r.deltaPct > 0 ? "bad" : ""}">${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(0)}%</td>`;
    const trail = r.runs.map(rn => {
      const cls = rn.verdict === "pass" ? "pass" : rn.verdict === "fail" ? "fail" : "partial";
      const tip = `${fmtDate(rn.createdAt)} · ${fmtMs(rn.latencyMs)} · score ${rn.score?.toFixed?.(1) ?? "—"} · ${rn.verdict ?? "—"}`;
      return `<span class="cost-pip ${cls}" title="${escapeHtml(tip)}">${fmtMs(rn.latencyMs)}</span>`;
    }).join(" ");
    tr.innerHTML = `
      <td><span class="dim-pill">${escapeHtml(r.dimension)}</span></td>
      <td class="prompt-cell">${escapeHtml(truncate(r.prompt, 110))}</td>
      <td class="num">${fmtInt(r.run_count)}</td>
      <td class="num">${fmtMs(r.first)}</td>
      <td class="num">${fmtMs(r.last)}</td>
      ${deltaCell}
      <td class="num">${fmtMs(r.avg_ms)}</td>
      <td class="num muted">${fmtMs(r.min_ms)}</td>
      <td class="num muted">${fmtMs(r.max_ms)}</td>
      <td class="trail-cell">${trail || '<span class="muted">—</span>'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ─────────── Outputs view (browse full agent responses across runs) ───────────

let outputsData = null;
const outputsExpanded = new Set();

async function bootOutputs() {
  outputsData = await fetchJson("/api/quality-outputs");
  populateOutputsFilters(outputsData);
  renderOutputsTable();

  $("#o-search").oninput = debounce(renderOutputsTable, 150);
  $("#o-run-filter").onchange = renderOutputsTable;
  $("#o-dim-filter").onchange = renderOutputsTable;
  $("#o-verdict-filter").onchange = renderOutputsTable;
  $("#o-sort").onchange = renderOutputsTable;
}

function populateOutputsFilters(rows) {
  // Build dropdowns from the actual data so we don't list runs/dims that
  // have zero results.
  const runMap = new Map();
  const dims = new Set();
  for (const r of rows) {
    if (!runMap.has(r.run_id)) {
      runMap.set(r.run_id, { id: r.run_id, createdAt: r.run_created_at, notes: r.run_notes, count: 0 });
    }
    runMap.get(r.run_id).count++;
    dims.add(r.dimension);
  }
  const runSel = $("#o-run-filter");
  const runCurrent = runSel.value;
  runSel.innerHTML = '<option value="">All runs</option>';
  for (const r of [...runMap.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = `${fmtDate(r.createdAt)} · ${r.count} result${r.count === 1 ? "" : "s"}${r.notes ? " · " + r.notes.slice(0, 40) : ""}`;
    runSel.appendChild(opt);
  }
  if (runCurrent) runSel.value = runCurrent;

  const dimSel = $("#o-dim-filter");
  const dimCurrent = dimSel.value;
  dimSel.innerHTML = '<option value="">All</option>';
  for (const d of [...dims].sort()) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    dimSel.appendChild(opt);
  }
  if (dimCurrent) dimSel.value = dimCurrent;
}

function renderOutputsTable() {
  if (!outputsData) return;
  const tbody = $("#o-table tbody");
  tbody.innerHTML = "";

  const runFilter = $("#o-run-filter").value;
  const dimFilter = $("#o-dim-filter").value;
  const verdictFilter = $("#o-verdict-filter").value;
  const search = $("#o-search").value.trim().toLowerCase();
  const sortMode = $("#o-sort").value;

  let rows = outputsData.filter(r => {
    if (runFilter && r.run_id !== runFilter) return false;
    if (dimFilter && r.dimension !== dimFilter) return false;
    if (verdictFilter && r.verdict !== verdictFilter) return false;
    if (search) {
      const hay = `${r.prompt || ""}\n${r.response_text || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    if (sortMode === "newest")      return new Date(b.created_at) - new Date(a.created_at);
    if (sortMode === "oldest")      return new Date(a.created_at) - new Date(b.created_at);
    if (sortMode === "score-desc")  return Number(b.score ?? 0) - Number(a.score ?? 0);
    if (sortMode === "score-asc")   return Number(a.score ?? 0) - Number(b.score ?? 0);
    if (sortMode === "length-desc") return Number(b.response_chars ?? 0) - Number(a.response_chars ?? 0);
    return 0;
  });

  $("#o-count").textContent = `${rows.length} result${rows.length === 1 ? "" : "s"}`;

  for (const r of rows) {
    const expanded = outputsExpanded.has(r.result_id);
    const tr = document.createElement("tr");
    tr.className = "o-row" + (expanded ? " expanded" : "");
    tr.dataset.id = r.result_id;
    const verdictCls = r.verdict === "pass" ? "pass" : r.verdict === "fail" ? "fail" : "partial";
    tr.innerHTML = `
      <td class="o-toggle">${expanded ? "▾" : "▸"}</td>
      <td class="num muted">${fmtDate(r.run_created_at)}</td>
      <td class="muted">${escapeHtml((r.run_notes || r.run_id).slice(0, 32))}</td>
      <td><span class="dim-pill">${escapeHtml(r.dimension)}</span></td>
      <td class="prompt-cell">${escapeHtml(truncate(r.prompt, 110))}</td>
      <td class="num">${r.score?.toFixed?.(1) ?? "—"}</td>
      <td><span class="verdict-pill ${verdictCls}">${escapeHtml(r.verdict || "—")}</span></td>
      <td class="num muted">${fmtInt(r.response_chars)}</td>
    `;
    tr.addEventListener("click", () => {
      if (outputsExpanded.has(r.result_id)) outputsExpanded.delete(r.result_id);
      else outputsExpanded.add(r.result_id);
      renderOutputsTable();
    });
    tbody.appendChild(tr);
    if (expanded) {
      const detail = document.createElement("tr");
      detail.className = "o-detail-row";
      const scores = r.criteria_scores && typeof r.criteria_scores === "object"
        ? Object.entries(r.criteria_scores)
            .map(([id, val]) => {
              const v = Number(val);
              const cls = v >= 1 ? "good" : v >= 0.5 ? "warn" : "bad";
              return `<span class="criterion-score ${cls}" title="${escapeHtml(id)}: ${v}"><code class="criterion-id">${escapeHtml(id)}</code> ${v.toFixed(1)}</span>`;
            })
            .join(" ")
        : null;
      const followUpBlock = r.follow_up_prompt
        ? `
            <div class="o-section o-followup">
              <div class="o-label">Follow-up turn (Opus-generated · ${fmtUsd(r.follow_up_cost)} · ${fmtMs(r.follow_up_latency_ms)})</div>
              <div class="o-val">↪ ${escapeHtml(r.follow_up_prompt)}</div>
              ${r.follow_up_response
                ? `<pre class="o-response">${escapeHtml(r.follow_up_response)}</pre>`
                : `<div class="o-val muted">(follow-up generated but response failed or empty)</div>`}
            </div>`
        : "";
      detail.innerHTML = `
        <td colspan="8">
          <div class="o-detail">
            <div class="o-section"><div class="o-label">Prompt</div><div class="o-val">${escapeHtml(r.prompt || "")}</div></div>
            ${r.error_message ? `<div class="o-section"><div class="o-label">Error</div><div class="o-val error">${escapeHtml(r.error_message)}</div></div>` : ""}
            ${r.critique ? `<div class="o-section"><div class="o-label">Critique</div><div class="o-val">${escapeHtml(r.critique)}</div></div>` : ""}
            ${scores ? `<div class="o-section"><div class="o-label">Criterion scores</div><div class="o-val">${scores}</div></div>` : ""}
            <div class="o-section"><div class="o-label">Response (${fmtInt(r.response_chars)} chars · cost ${fmtUsd(r.cost_usd)} · ${fmtMs(r.latency_ms)})</div><pre class="o-response">${escapeHtml(r.response_text || "(empty)")}</pre></div>
            ${followUpBlock}
          </div>
        </td>
      `;
      tbody.appendChild(detail);
    }
  }
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

document.addEventListener("DOMContentLoaded", () => {
  $("#mode-tolerance").addEventListener("click", () => switchMode("tolerance"));
  $("#mode-quality").addEventListener("click", () => switchMode("quality"));
  $("#mode-costs").addEventListener("click", () => switchMode("costs"));
  $("#mode-latency").addEventListener("click", () => switchMode("latency"));
  $("#mode-outputs").addEventListener("click", () => switchMode("outputs"));
});

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div style="background:#f87171;color:#0a0b0d;padding:10px 20px;font-family:monospace">Error: ${escapeHtml(e.message || String(e))}</div>`,
  );
});
