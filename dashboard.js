
const DATA_URL = "./dashboard-data.json";

let dataset = null;
let periodDays = 7;
let searchQuery = "";

const $ = (id) => document.getElementById(id);

const tooltip = $("tooltip");

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(value) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getChecks() {
  const cutoff = Date.now() - periodDays * 86400000;

  return dataset.checks.filter(
    (check) => new Date(check.timestamp).getTime() >= cutoff
  );
}

function getResult(check, id) {
  return check.results.find((result) => result.id === id);
}

function getServiceHistory(id, checks) {
  return checks
    .map((check) => ({
      timestamp: check.timestamp,
      result: getResult(check, id),
    }))
    .filter((item) => item.result);
}

function uptimePercent(history) {
  const conclusive = history.filter(
    (item) => ["up", "down"].includes(item.result.status)
  );

  if (!conclusive.length) return null;

  const successful = conclusive.filter(
    (item) => item.result.status === "up"
  ).length;

  return (successful / conclusive.length) * 100;
}

function averageLatency(history) {
  const valid = history.filter(
    (item) => item.result.status === "up"
  );

  if (!valid.length) return null;

  return Math.round(
    valid.reduce(
      (sum, item) => sum + item.result.latency_ms,
      0
    ) / valid.length
  );
}

function createHistoryBars(id, history) {
  const slots = 48;
  const duration = periodDays * 86400000;
  const end = Date.now();
  const start = end - duration;
  const slotMs = duration / slots;

  const container = document.createElement("div");
  container.className = "history";

  for (let i = 0; i < slots; i++) {
    const from = start + i * slotMs;
    const to = from + slotMs;

    const items = history.filter((item) => {
      const timestamp = new Date(item.timestamp).getTime();
      return timestamp >= from && timestamp < to;
    });

    let status = "missing";

    if (items.some((item) => item.result.status === "down")) {
      status = "down";
    } else if (items.some((item) => item.result.status === "unknown")) {
      status = "unknown";
    } else if (items.length) {
      status = "up";
    }

    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = `history-bar ${status}`;

    const avg = averageLatency(items);
    const failures = items.filter(
      (item) => item.result.status === "down"
    ).length;

    const details = [
      `${formatTime(from)} – ${formatTime(to)}`,
      `Status: ${status.toUpperCase()}`,
      `Checks: ${items.length}`,
      `Failures: ${failures}`,
      `Average latency: ${avg === null ? "N/A" : avg + " ms"}`,
    ];

    if (items.length) {
      const latest = items[items.length - 1].result;
      details.push(`Latest HTTP: ${latest.http_status ?? "N/A"}`);

      if (latest.error) {
        details.push(`Error: ${latest.error}`);
      }
    }

    const content = details.join("\n");

    bar.setAttribute("aria-label", content);
    bar.title = content;

    bar.addEventListener("mouseenter", (event) => {
      showTooltip(content, event);
    });

    bar.addEventListener("mousemove", moveTooltip);
    bar.addEventListener("mouseleave", hideTooltip);

    bar.addEventListener("focus", (event) => {
      showTooltip(content, event);
    });

    bar.addEventListener("blur", hideTooltip);

    bar.addEventListener("click", (event) => {
      showTooltip(content, event);
    });

    container.appendChild(bar);
  }

  return container;
}

function showTooltip(content, event) {
  tooltip.textContent = content;
  tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const rect = event.currentTarget.getBoundingClientRect();

  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;

  const left = Math.min(
    window.innerWidth - width - 12,
    Math.max(12, rect.left + rect.width / 2 - width / 2)
  );

  const top = Math.max(
    12,
    rect.top - height - 10
  );

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function renderSummary(checks) {
  const latest = dataset.checks.at(-1);

  $("total").textContent = dataset.services.length;

  if (!latest) {
    $("operational").textContent = "—";
    $("unreachable").textContent = "—";
    $("avg-latency").textContent = "—";
    $("last-check").textContent = "No monitoring reports yet.";
    return;
  }

  const results = latest.results;
  const up = results.filter((r) => r.status === "up").length;
  const down = results.filter((r) => r.status === "down").length;

  const valid = results.filter((r) => r.status === "up");
  const avg = valid.length
    ? Math.round(
        valid.reduce((sum, r) => sum + r.latency_ms, 0) /
        valid.length
      )
    : null;

  $("operational").textContent = up;
  $("unreachable").textContent = down;
  $("avg-latency").textContent = avg === null ? "—" : `${avg} ms`;

  $("last-check").textContent =
    `Last check: ${formatTime(latest.timestamp)}`;

  const badge = $("overall-status");
  const age = Date.now() - new Date(latest.timestamp).getTime();

  badge.className = "status-badge";

  if (age > 45 * 60000) {
    badge.textContent = "Monitoring delayed";
  } else if (down > 0) {
    badge.textContent = `${down} endpoint issue${down === 1 ? "" : "s"}`;
    badge.classList.add("problem");
  } else {
    badge.textContent = "No probe failures";
    badge.classList.add("healthy");
  }
}

function renderServices(checks) {
  const root = $("services");
  root.replaceChildren();

  const categories = [...new Set(
    dataset.services.map((service) => service.category)
  )];

  for (const category of categories) {
    const services = dataset.services.filter(
      (service) =>
        service.category === category &&
        service.name.toLowerCase().includes(searchQuery)
    );

    if (!services.length) continue;

    const section = document.createElement("section");
    section.className = "category";

    const heading = document.createElement("div");
    heading.className = "category-title";
    heading.innerHTML = `
      <h2>${escapeHTML(category)}</h2>
      <span>${services.length} services</span>
    `;
    section.appendChild(heading);

    for (const service of services) {
      const history = getServiceHistory(service.id, checks);
      const latest = dataset.checks.at(-1);
      const current = latest && getResult(latest, service.id);
      const uptime = uptimePercent(history);
      const latency = averageLatency(history);

      const row = document.createElement("div");
      row.className = "service";

      const top = document.createElement("div");
      top.className = "service-top";

      const status = current?.status ?? "missing";

      top.innerHTML = `
        <div>
          <div class="service-name">
            <a href="${escapeHTML(service.url)}"
               target="_blank"
               rel="noopener noreferrer">
              ${escapeHTML(service.name)}
            </a>
          </div>
          <div class="service-meta">
            ${latency === null ? "No latency data" : latency + " ms average"}
          </div>
        </div>
        <div class="service-status">
          <i class="dot ${status}"></i>
          ${escapeHTML(status.toUpperCase())}
        </div>
      `;

      row.appendChild(top);
      row.appendChild(createHistoryBars(service.id, history));

      const bottom = document.createElement("div");
      bottom.className = "service-bottom";

      bottom.innerHTML = `
        <span>${periodDays === 1 ? "24h" : periodDays + "d"} ago</span>
        <span>
          ${uptime === null ? "No data" : uptime.toFixed(2) + "% uptime"}
        </span>
        <span>Now</span>
      `;

      row.appendChild(bottom);
      section.appendChild(row);
    }

    root.appendChild(section);
  }
}

function renderIncidents(checks) {
  const incidents = [];

  for (const check of checks) {
    for (const result of check.results) {
      if (result.status === "down") {
        incidents.push({
          timestamp: check.timestamp,
          ...result,
        });
      }
    }
  }

  incidents.sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  const root = $("incidents");
  root.replaceChildren();

  if (!incidents.length) {
    const empty = document.createElement("div");
    empty.className = "incident";
    empty.textContent = "No probe failures recorded in this period.";
    root.appendChild(empty);
    return;
  }

  for (const incident of incidents.slice(0, 20)) {
    const item = document.createElement("div");
    item.className = "incident";

    item.innerHTML = `
      <strong>${escapeHTML(incident.name)}</strong>
      <p>
        ${escapeHTML(formatTime(incident.timestamp))}
        · HTTP ${escapeHTML(incident.http_status ?? "N/A")}
        · ${escapeHTML(incident.error || "Request failed")}
      </p>
    `;

    root.appendChild(item);
  }
}

function render() {
  if (!dataset) return;

  const checks = getChecks();
  renderSummary(checks);
  renderServices(checks);
  renderIncidents(checks);
}

async function loadData() {
  try {
    const response = await fetch(
      `${DATA_URL}?t=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    dataset = await response.json();
    render();
  } catch (error) {
    $("last-check").textContent =
      `Unable to load monitoring data: ${error.message}`;
    $("overall-status").textContent = "Data unavailable";
  }
}

document.querySelectorAll("[data-period]").forEach((button) => {
  button.addEventListener("click", () => {
    periodDays = Number(button.dataset.period);

    document.querySelectorAll("[data-period]").forEach(
      (item) => item.classList.remove("active")
    );

    button.classList.add("active");
    hideTooltip();
    render();
  });
});

$("search").addEventListener("input", (event) => {
  searchQuery = event.target.value.toLowerCase().trim();
  render();
});

$("refresh").addEventListener("click", loadData);

document.addEventListener("click", (event) => {
  if (!event.target.closest(".history-bar")) {
    hideTooltip();
  }
});

loadData();
