/* Shared simulator UI: socket connection, Settings tab, forecast timeline and formatting helpers. */

export const socket = io();

/** Sends a UI action to the simulator and shows any error. */
export function act(name, args = {}) {
    return new Promise(resolve => {
        socket.emit("action", { name, args }, result => {
            if (result?.error) toast(result.error, "danger");
            resolve(result);
        });
    });
}

export function toast(message, kind = "secondary") {
    const area = document.getElementById("toasts");
    const el = document.createElement("div");
    el.className = `alert alert-${kind} py-2 px-3 mb-2 shadow-sm`;
    el.textContent = message;
    area.append(el);
    setTimeout(() => el.remove(), 5000);
}

export const $ = id => document.getElementById(id);

export function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return "–";
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

export function formatTime(unixS, withSeconds = false) {
    if (!unixS) return "–";
    const date = new Date(unixS * 1000);
    const sameDay = date.toDateString() === new Date().toDateString();
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false, ...(withSeconds ? { second: "2-digit" } : {}) });
    return sameDay ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function formatPower(watts) {
    const abs = Math.abs(watts);
    return abs >= 1000 ? `${(watts / 1000).toFixed(2)} kW` : `${Math.round(watts)} W`;
}

/**
 * Renders a forecast as a step chart of slot power over time.
 * forecast: { startUnixS, slots: [{ durationS, watts }], activeSlotNumber, ... } or null.
 */
export function renderForecast(container, forecast, options = {}) {
    if (!forecast || !forecast.slots.length) {
        container.innerHTML = `<div class="text-body-secondary small py-4 text-center">No forecast published</div>`;
        return;
    }
    const width = 600;
    const height = 140;
    const pad = { left: 60, right: 8, top: 10, bottom: 22 };
    const total = forecast.slots.reduce((sum, s) => sum + s.durationS, 0);
    const maxW = Math.max(...forecast.slots.map(s => s.watts), 0);
    const minW = Math.min(...forecast.slots.map(s => s.watts), 0);
    const range = maxW - minW || 1;
    const x = t => pad.left + (t / total) * (width - pad.left - pad.right);
    const y = w => pad.top + ((maxW - w) / range) * (height - pad.top - pad.bottom);

    let t = 0;
    const bars = forecast.slots.map((slot, index) => {
        const x0 = x(t);
        const x1 = x(t + slot.durationS);
        t += slot.durationS;
        const top = Math.min(y(slot.watts), y(0));
        const h = Math.max(1, Math.abs(y(slot.watts) - y(0)));
        const cls = index === forecast.activeSlotNumber ? "slot active" : slot.watts < 0 ? "slot generation" : "slot";
        const label = options.slotLabel ? options.slotLabel(slot, index) : "";
        return `<rect class="${cls}" x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${h.toFixed(1)}"><title>Slot ${index + 1}${label ? ` (${label})` : ""}: ${formatPower(slot.watts)} for ${formatDuration(slot.durationS)}</title></rect>`;
    });

    const ticks = [];
    const tickCount = 6;
    for (let i = 0; i <= tickCount; i++) {
        const offset = (total * i) / tickCount;
        ticks.push(`<text class="tick" x="${x(offset).toFixed(1)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : i === tickCount ? "end" : "middle"}">${formatTime(forecast.startUnixS + offset, total < 1800)}</text>`);
    }

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" class="forecast-chart" role="img" aria-label="Forecast power by slot">
            <defs><pattern id="activeHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#000" stroke-width="2.5"/></pattern></defs>
            <line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}"/>
            ${maxW > 0 ? `<text class="tick" x="${pad.left - 4}" y="${y(maxW) + 4}" text-anchor="end">${formatPower(maxW)}</text>` : ""}
            ${minW < 0 ? `<text class="tick" x="${pad.left - 4}" y="${y(minW)}" text-anchor="end">${formatPower(minW)}</text>` : ""}
            ${bars.join("")}
            ${ticks.join("")}
        </svg>`;
}

/** Renders a forecast summary table. */
export function renderForecastMeta(container, forecast, extra = {}) {
    if (!forecast) {
        container.innerHTML = "";
        return;
    }
    const rows = [
        ["Forecast ID", forecast.forecastId],
        ["Update reason", forecast.reason],
        ["Start", formatTime(forecast.startUnixS)],
        ["End", formatTime(forecast.endUnixS)],
        ["Slots", forecast.slots.length],
        ["Active slot", forecast.activeSlotNumber === null ? "–" : forecast.activeSlotNumber + 1],
        ...Object.entries(extra),
    ];
    container.innerHTML = rows.map(([k, v]) => `<div class="col-6 col-md-4"><div class="meta-label">${k}</div><div class="meta-value">${v}</div></div>`).join("");
}

const SETTINGS_HTML = `
<div class="row g-4">
  <div class="col-lg-6">
    <div class="card h-100">
      <div class="card-header">Commissioning</div>
      <div class="card-body">
        <div class="d-flex gap-3 align-items-start">
          <div id="qr" class="qr border"></div>
          <div>
            <div class="meta-label">Status</div>
            <div id="commissionStatus" class="meta-value mb-2">–</div>
            <div class="meta-label">Manual pairing code</div>
            <div id="manualCode" class="meta-value font-monospace fs-5 mb-2">–</div>
            <div class="meta-label">QR payload</div>
            <div id="qrCode" class="font-monospace small mb-3">–</div>
            <button id="openWindow" class="btn btn-dark">Open commissioning window</button>
            <div id="windowStatus" class="small text-body-secondary mt-2"></div>
          </div>
        </div>
        <h6 class="mt-4">Fabrics</h6>
        <table class="table table-sm mb-0">
          <thead><tr><th>Index</th><th>Label</th><th>Vendor</th><th>Node ID</th></tr></thead>
          <tbody id="fabrics"><tr><td colspan="4" class="text-body-secondary">Not commissioned</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>
  <div class="col-lg-6">
    <div class="card mb-4">
      <div class="card-header">Simulation</div>
      <div class="card-body" id="simulationSettings">
        <label class="form-label" for="speed">Simulation speed</label>
        <select id="speed" class="form-select w-auto">
          <option value="1">1× (real time)</option>
          <option value="10">10×</option>
          <option value="60">60× (1 minute per second)</option>
          <option value="300">300×</option>
        </select>
        <div id="speedHelp" class="form-text">Speeds up running programs. Forecast durations are scaled to match.</div>
      </div>
    </div>
    <div class="card border-danger">
      <div class="card-header text-danger">Factory reset</div>
      <div class="card-body">
        <p class="mb-3">Removes all fabrics, clears Matter storage and simulator settings, then restarts the device ready to be commissioned again.</p>
        <button class="btn btn-outline-danger" data-bs-toggle="modal" data-bs-target="#resetModal">Factory reset…</button>
      </div>
    </div>
  </div>
</div>
<div class="modal fade" id="resetModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">Factory reset?</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
    <div class="modal-body">The device will leave every fabric. Controllers will need to commission it again.</div>
    <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button><button id="confirmReset" class="btn btn-danger">Reset</button></div>
  </div></div>
</div>`;

/** Renders the Settings tab and keeps it current. `speed` controls are hidden when the simulator has none. */
export function initSettings({ speed = true, speedHelp } = {}) {
    $("settings").innerHTML = SETTINGS_HTML;
    if (!speed) $("simulationSettings").closest(".card").remove();
    else if (speedHelp) $("speedHelp").textContent = speedHelp;

    $("openWindow").addEventListener("click", () => {
        $("openWindow").disabled = true;
        socket.emit("openCommissioningWindow", result => {
            $("openWindow").disabled = false;
            if (result?.error) toast(result.error, "danger");
            else toast("Commissioning window opened for 3 minutes", "success");
        });
    });
    $("confirmReset").addEventListener("click", () => {
        $("confirmReset").disabled = true;
        socket.emit("factoryReset", result => {
            $("confirmReset").disabled = false;
            bootstrap.Modal.getInstance($("resetModal"))?.hide();
            if (result?.error) toast(result.error, "danger");
            else toast("Device reset to factory defaults", "success");
        });
    });
    $("speed")?.addEventListener("change", event => act("setSpeed", { speed: Number(event.target.value) }));

    socket.on("commissioning", info => {
        if (!info.online && !info.qrPairingCode) {
            $("commissionStatus").innerHTML = `<span class="badge text-bg-secondary">Offline</span>`;
            return;
        }
        $("qr").innerHTML = info.qrSvg;
        $("manualCode").textContent = info.manualPairingCode.replace(/(\d{4})(\d{3})(\d{4})/, "$1-$2-$3");
        $("qrCode").textContent = info.qrPairingCode;
        $("commissionStatus").innerHTML = !info.online
            ? `<span class="badge text-bg-secondary">Offline</span>`
            : info.commissioned
                ? `<span class="badge text-bg-success">Commissioned</span> to ${info.fabrics.length} fabric${info.fabrics.length === 1 ? "" : "s"}`
                : `<span class="badge text-bg-warning">Not commissioned</span>`;
        $("windowStatus").textContent = info.windowOpen
            ? info.windowRemainingS ? `Window open, closes in ${formatDuration(info.windowRemainingS)}` : "Window open, waiting for a controller"
            : "";
        $("fabrics").innerHTML = info.fabrics.length
            ? info.fabrics.map(f => `<tr><td>${f.fabricIndex}</td><td>${escapeHtml(f.label || "–")}</td><td>0x${Number(f.vendorId).toString(16).toUpperCase()}</td><td class="font-monospace">${f.nodeId}</td></tr>`).join("")
            : `<tr><td colspan="4" class="text-body-secondary">Not commissioned</td></tr>`;
    });
}

/** Keeps the speed selector in sync with simulator state. */
export function syncSpeed(speed) {
    const el = $("speed");
    if (el && document.activeElement !== el) el.value = String(speed);
}

export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Sets a value only when the user isn't editing it. */
export function setIfIdle(el, value) {
    if (document.activeElement !== el) el.value = value;
}
