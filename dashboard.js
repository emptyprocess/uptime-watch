
const DATA_URL = "./dashboard-data.json";
const STALE_MINUTES = 45;
const HISTORY_SLOTS = 32;

const state = {
  data: null,
  filter: "all",
  search: "",
  expandedCategories: new Set(),
  expandedService: null,
};

const $ = (id) => document.getElementById(id);

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const formatTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleString();
};

const formatLatency = (value) =>
  Number.isFinite(Number(value))
    ? `${Math.round(Number(value))} ms`
    : "—";

const serviceLogo = (service) => {
  const domain = new URL(service.url).hostname;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
};

function allChecks() {
  return Array.isArray(state.data?.checks)
    ? state.data.checks
    : [];
}

function serviceChecks(id) {
  return allChecks()
    .map((check) => ({
      timestamp: check.timestamp,
      result: check.results?.find((r) => r.id === id),
    }))
    .filter((item) => item.result);
}

function latestResult(id) {
  const checks = serviceChecks(id);
  return checks.length ? checks[checks.length - 1] : null;
}

function statusFor(service) {
  const latest = latestResult(service.id);

  if (!latest) return "stale";

  const age = Date.now() - new Date(latest.timestamp).getTime();

  if (!Number.isFinite(age) || age > STALE_MINUTES * 60000) {
    return "stale";
  }

  const status = latest.result.status;
  return ["up", "down", "unknown"].includes(status)
    ? status
    : "unknown";
}

function statusLabel(status) {
  return {
    up: "Operational",
    down: "Unreachable",
    unknown: "Inconclusive",
    stale: "No recent data",
  }[status] || "Unknown";
}

function services() {
  return Array.isArray(state.data?.services)
    ? state.data.services
    : [];
}

function summary() {
  const counts = { up: 0, down: 0, unknown: 0, stale: 0 };

  for (const service of services()) {
    counts[statusFor(service)]++;
  }

  return counts;
}

function renderSummary() {
  const counts = summary();
  const total = services().length;

  $("totalCount").textContent = total;
  $("upCount").textContent = counts.up;
  $("unknownCount").textContent = counts.unknown;
  $("downCount").textContent = counts.down;

  const latencies = services()
    .filter((s) => statusFor(s) !== "stale")
    .map((s) => latestResult(s.id)?.result.latency_ms)
    .filter((n) => Number.isFinite(Number(n)))
    .map(Number);

  $("avgLatency").textContent = latencies.length
    ? formatLatency(
        latencies.reduce((a, b) => a + b, 0) / latencies.length
      )
    : "—";

  const badge = $("healthBadge");

  badge.textContent = counts.down
    ? `${counts.down} unreachable`
    : counts.stale
      ? `${counts.stale} without recent data`
      : counts.unknown
        ? `${counts.unknown} inconclusive`
        : "All monitored endpoints reachable";

  badge.style.color = counts.down
    ? "var(--red)"
    : counts.stale || counts.unknown
      ? "var(--amber)"
      : "var(--green)";

  const newest = allChecks().at(-1);

  $("lastChecked").textContent = newest
    ? `Latest check: ${formatTime(newest.timestamp)}`
    : "No monitoring data yet";

  const coverage = total
    ? ((total - counts.stale) / total) * 100
    : 0;

  $("coverageText").textContent =
    `${coverage.toFixed(1)}% have recent checks`;

  $("coverageFill").style.width = `${coverage}%`;
}

function renderYard() {
  const sorted = [...services()].sort(
    (a, b) => priority(statusFor(a)) - priority(statusFor(b))
  );

  const yard = $("containerYard");
  yard.replaceChildren();

  for (const service of sorted) {
    const button = document.createElement("button");
    const status = statusFor(service);

    button.className = `yard-container ${status}`;
    button.type = "button";
    button.title = `${service.name}: ${statusLabel(status)}`;
    button.setAttribute(
      "aria-label",
      `${service.name}: ${statusLabel(status)}`
    );

    button.addEventListener("click", () => {
      state.filter = "all";
      state.search = "";
      $("searchInput").value = "";
      state.expandedCategories.add(service.category);
      state.expandedService = service.id;

      syncFilterButtons();
      renderServices();

      document.getElementById(`service-${CSS.escape(service.id)}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    yard.append(button);
  }
}

function priority(status) {
  return { down: 0, unknown: 1, stale: 2, up: 3 }[status] ?? 4;
}

function historyBars(id) {
  const now = Date.now();
  const duration = 24 * 60 * 60 * 1000;
  const slotDuration = duration / HISTORY_SLOTS;
  const checks = serviceChecks(id);

  let html = "";

  for (let i = 0; i < HISTORY_SLOTS; i++) {
    const start = now - duration + i * slotDuration;
    const end = start + slotDuration;

    const matching = checks.filter((c) => {
      const t = new Date(c.timestamp).getTime();
      return t >= start && t < end;
    });

    let status = "";

    if (matching.length) {
      if (matching.some((c) => c.result.status === "down")) {
        status = "down";
      } else if (matching.some((c) => c.result.status === "unknown")) {
        status = "unknown";
      } else {
        status = "up";
      }
    }

    const title = matching.length
      ? `${matching.length} checks: ${statusLabel(status)}`
      : "No checks recorded";

    html += `<span class="history-cell ${status}"
      title="${escapeHTML(title)}"></span>`;
  }

  return `<div class="mini-history" aria-label="Last 24 hours">${html}</div>`;
}

function uptimeFor(id, days = 30) {
  const cutoff = Date.now() - days * 86400000;

  const results = serviceChecks(id)
    .filter((c) => new Date(c.timestamp).getTime() >= cutoff)
    .map((c) => c.result.status);

  const up = results.filter((s) => s === "up").length;
  const down = results.filter((s) => s === "down").length;
  const counted = up + down;

  return counted ? `${(up / counted * 100).toFixed(2)}%` : "—";
}

function chartSVG(points, label = "Response time") {
  const valid = points.filter(
    (p) => Number.isFinite(Number(p.value))
  );

  if (valid.length < 2) {
    return `<div class="empty">Not enough historical data for a chart.</div>`;
  }

  const width = 600;
  const height = 185;
  const pad = 16;
  const max = Math.max(100, ...valid.map((p) => Number(p.value))) * 1.15;

  const coordinates = valid.map((p, i) => {
    const x = pad + i / (valid.length - 1) * (width - 2 * pad);
    const y = height - pad - Number(p.value) / max * (height - 2 * pad);
    return [x, y];
  });

  const line = coordinates
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const fill = `${line} L${coordinates.at(-1)[0]},${height - pad}
    L${coordinates[0][0]},${height - pad} Z`;

  const grid = [0.25, 0.5, 0.75].map((f) => {
    const y = height * f;
    return `<line x1="0" y1="${y}" x2="${width}" y2="${y}"
      stroke="#294052" stroke-dasharray="4 6" />`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}"
    role="img" aria-label="${escapeHTML(label)}">
    <defs>
      <linearGradient id="latencyFill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#18dc83" stop-opacity=".26"/>
        <stop offset="100%" stop-color="#18dc83" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${fill}" fill="url(#latencyFill)"/>
    <path d="${line}" fill="none" stroke="#18dc83"
      stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function renderOverviewChart() {
  const cutoff = Date.now() - 86400000;

  const points = allChecks()
    .filter((c) => new Date(c.timestamp).getTime() >= cutoff)
    .map((check) => {
      const values = (check.results || [])
        .filter((r) => r.status === "up")
        .map((r) => Number(r.latency_ms))
        .filter(Number.isFinite);

      return {
        value: values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null,
      };
    })
    .filter((p) => p.value !== null);

  $("overviewChart").innerHTML =
    chartSVG(points, "Average response time over 24 hours");
}

function serviceDetails(service) {
  const checks = serviceChecks(service.id);
  const latest = latestResult(service.id);
  const cutoff = Date.now() - 86400000;

  const points = checks
    .filter((c) => new Date(c.timestamp).getTime() >= cutoff)
    .map((c) => ({ value: c.result.latency_ms }));

  const http = latest?.result.http_status ?? "—";
  const latency = latest
    ? formatLatency(latest.result.latency_ms)
    : "—";

  return `<div class="service-details">
    <div class="detail-stats">
      <div><span>Uptime (30d, observed)</span><strong>${uptimeFor(service.id)}</strong></div>
      <div><span>Latest latency</span><strong>${latency}</strong></div>
      <div><span>HTTP status</span><strong>${escapeHTML(http)}</strong></div>
      <div><span>Last check</span><strong>${latest ? escapeHTML(formatTime(latest.timestamp)) : "—"}</strong></div>
    </div>
    <h3>Latency · last 24 hours</h3>
    <div class="chart-area">${chartSVG(points, `${service.name} latency`)}</div>
    <div class="detail-actions">
      <a href="${escapeHTML(service.url)}" target="_blank"
         rel="noopener noreferrer">Visit endpoint ↗</a>
    </div>
  </div>`;
}

function renderServices() {
  const groups = new Map();

  for (const service of services()) {
    const status = statusFor(service);

    if (state.filter !== "all" && state.filter !== status) continue;

    if (!`${service.name} ${service.category}`.toLowerCase()
      .includes(state.search.toLowerCase())) continue;

    if (!groups.has(service.category)) groups.set(service.category, []);
    groups.get(service.category).push(service);
  }

  const root = $("serviceGroups");
  root.replaceChildren();

  if (!groups.size) {
    root.innerHTML = `<div class="panel empty">No matching services.</div>`;
    return;
  }

  for (const [category, items] of groups) {
    items.sort((a, b) =>
      priority(statusFor(a)) - priority(statusFor(b)) ||
      a.name.localeCompare(b.name)
    );

    const expanded = state.search ||
      state.filter !== "all" ||
      state.expandedCategories.has(category);

    const section = document.createElement("section");
    section.className = `category ${expanded ? "" : "collapsed"}`;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "category-header";
    header.innerHTML = `<span>
      <span class="category-title">${escapeHTML(category)}</span>
      <span class="category-count">${items.length} services</span>
    </span><span>${expanded ? "⌃" : "⌄"}</span>`;

    header.addEventListener("click", () => {
      if (state.expandedCategories.has(category)) {
        state.expandedCategories.delete(category);
      } else {
        state.expandedCategories.add(category);
      }
      renderServices();
    });

    const body = document.createElement("div");
    body.className = "category-body";

    for (const service of items) {
      const status = statusFor(service);
      const latest = latestResult(service.id);
      const expandedService = state.expandedService === service.id;

      const row = document.createElement("div");
      row.className = "service-row";
      row.id = `service-${service.id}`;

      const summary = document.createElement("button");
      summary.type = "button";
      summary.className = "service-summary";
      summary.setAttribute("aria-expanded", String(expandedService));

      const identity = document.createElement("span");
      identity.className = "service-identity";

      const img = document.createElement("img");
      img.className = "service-logo";
      img.src = serviceLogo(service);
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => {
        const fallback = document.createElement("span");
        fallback.className = "service-logo service-fallback";
        fallback.textContent = service.name[0]?.toUpperCase() || "?";
        img.replaceWith(fallback);
      };

      const name = document.createElement("span");
      name.className = "service-name";
      name.textContent = service.name;

      identity.append(img, name);

      const pill = document.createElement("span");
      pill.className = `status-pill ${status}`;
      pill.textContent = statusLabel(status);

      const latency = document.createElement("span");
      latency.className = "muted";
      latency.textContent = latest
        ? formatLatency(latest.result.latency_ms)
        : "—";

      const bars = document.createElement("span");
      bars.innerHTML = historyBars(service.id);

      const arrow = document.createElement("span");
      arrow.textContent = expandedService ? "⌃" : "›";

      summary.append(identity, pill, latency, bars, arrow);

      summary.addEventListener("click", () => {
        state.expandedService = expandedService ? null : service.id;
        renderServices();
      });

      row.append(summary);

      if (expandedService) {
        const details = document.createElement("div");
        details.innerHTML = serviceDetails(service);
        row.append(details.firstElementChild);
      }

      body.append(row);
    }

    section.append(header, body);
    root.append(section);
  }
}

function renderIncidents() {
  const incidents = [];

  for (const check of allChecks()) {
    for (const result of check.results || []) {
      if (result.status === "down") {
        incidents.push({
          timestamp: check.timestamp,
          name: result.name || result.id,
          error: result.error || `HTTP ${result.http_status ?? "unknown"}`,
        });
      }
    }
  }

  incidents.sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  $("incidentList").innerHTML = incidents.length
    ? incidents.slice(0, 15).map((item) => `
      <div class="incident-item">
        <div><strong>${escapeHTML(item.name)}</strong>
          <div class="muted">${escapeHTML(item.error)}</div>
        </div>
        <span class="muted">${escapeHTML(formatTime(item.timestamp))}</span>
      </div>
    `).join("")
    : `<div class="empty">No failed checks recorded in the available history.</div>`;
}

function syncFilterButtons() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle(
      "active", button.dataset.filter === state.filter
    );
  });
}

async function loadDashboard() {
  $("refreshBtn").disabled = true;

  try {
    const response = await fetch(
      `${DATA_URL}?t=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    state.data = await response.json();

    if (!state.expandedCategories.size && !state.initialized) {
      const first = services()[0]?.category;
      if (first) state.expandedCategories.add(first);
      state.initialized = true;
    }

    renderSummary();
    renderYard();
    renderOverviewChart();
    renderServices();
    renderIncidents();

  } catch (error) {
    $("healthBadge").textContent = "Data unavailable";
    $("serviceGroups").innerHTML =
      `<div class="panel empty">Unable to load dashboard data.</div>`;
    console.error(error);

  } finally {
    $("refreshBtn").disabled = false;
  }
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    syncFilterButtons();
    renderServices();
  });
});

$("searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderServices();
});

$("expandAll").addEventListener("click", () => {
  services().forEach((s) => state.expandedCategories.add(s.category));
  renderServices();
});

$("collapseAll").addEventListener("click", () => {
  state.expandedCategories.clear();
  state.search = "";
  state.filter = "all";
  $("searchInput").value = "";
  syncFilterButtons();
  renderServices();
});

$("refreshBtn").addEventListener("click", loadDashboard);

loadDashboard();
