import { $, act, formatDuration, formatPower, formatTime, initSettings, renderForecast, renderForecastMeta, setIfIdle, socket, syncSpeed } from "./common.js";

const OPT_OUT = ["Opted in", "Local opt-out", "Grid opt-out", "Opted out"];
const STATE_LABEL = { idle: "Idle", pending: "Waiting to start", running: "Running", paused: "Paused" };

initSettings();

let programsRendered = "";
let state;

$("program").addEventListener("change", e => act("selectProgram", { programId: Number(e.target.value) }));
$("optIn").addEventListener("change", e => act("setOptIn", { optIn: e.target.checked }));
$("finishBy").addEventListener("change", e => {
    const value = e.target.value;
    act("setFinishBy", { finishByUnixS: value ? Math.floor(new Date(value).getTime() / 1000) : null });
});
for (const option of ["temperature", "spin", "rinses"]) {
    $(option).addEventListener("change", e => act("setOptions", { [option]: Number(e.target.value) }));
}
for (const name of ["start", "pause", "resume", "stop"]) {
    $(name).addEventListener("click", () => act(name));
}

function toLocalInput(unixS) {
    const d = new Date(unixS * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

socket.on("state", s => {
    state = s;
    const running = s.runState === "running";
    document.body.className = [running ? "running" : "", s.currentPhase !== null ? `phase-${s.phases[s.currentPhase]}` : ""].join(" ");

    const key = JSON.stringify(s.programs);
    if (key !== programsRendered) {
        programsRendered = key;
        $("program").innerHTML = s.programs
            .map(p => `<option value="${p.id}">${p.name} · ${Math.round(p.minutes)} min · ${p.kWh.toFixed(2)} kWh</option>`)
            .join("");
    }
    setIfIdle($("program"), String(s.program.id));
    $("program").disabled = s.runState !== "idle";
    fillOptions($("temperature"), s.temperatureLevels, s.temperature);
    fillOptions($("spin"), s.spinSpeeds.map(rpm => `${rpm} rpm`), s.spin);
    fillOptions($("rinses"), s.rinseOptions, s.rinses);
    for (const option of ["temperature", "spin", "rinses"]) $(option).disabled = running || s.runState === "paused";
    $("optIn").checked = s.optIn;
    setIfIdle($("finishBy"), s.finishByUnixS ? toLocalInput(s.finishByUnixS) : "");
    $("finishBy").disabled = running || s.runState === "paused";

    $("start").disabled = s.runState !== "idle";
    $("pause").disabled = !running;
    $("resume").disabled = s.runState !== "paused";
    $("stop").disabled = s.runState === "idle";

    $("stateBadge").textContent = STATE_LABEL[s.runState];
    $("stateBadge").classList.toggle("on", s.runState !== "idle");
    $("runState").textContent = STATE_LABEL[s.runState];
    $("phase").textContent = s.currentPhase === null ? "–" : s.phases[s.currentPhase];
    $("countdown").textContent = formatDuration(s.countdownS);
    $("startsAt").textContent = s.runState === "pending" ? formatTime(s.startUnixS) : "–";
    $("power").textContent = formatPower(s.powerW);
    $("energy").textContent = `${s.energyKWh.toFixed(3)} kWh`;
    $("optOutState").textContent = OPT_OUT[s.optOutState];
    $("message").textContent = s.message || "–";
    $("display").textContent = s.countdownS === null ? "--:--" : formatDisplay(s.countdownS);
    syncSpeed(s.speed);

    renderForecast($("forecastChart"), s.forecast, { slotLabel: (_slot, i) => s.phases[s.steps[i]?.phase] ?? "" });
    renderForecastMeta($("forecastMeta"), s.forecast, {
        "Start window": s.earliestStartUnixS ? `${formatTime(s.earliestStartUnixS)} – ${formatTime(s.latestEndUnixS - s.runtimeS)}` : "Fixed",
        "Latest end": s.latestEndUnixS ? formatTime(s.latestEndUnixS) : "–",
        "Pausable": "No",
    });
});

function formatDisplay(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
}

function fillOptions(select, labels, selected) {
    const html = labels.map((label, i) => `<option value="${i}">${label}</option>`).join("");
    if (select.dataset.html !== html) {
        select.innerHTML = html;
        select.dataset.html = html;
    }
    setIfIdle(select, String(selected));
}
