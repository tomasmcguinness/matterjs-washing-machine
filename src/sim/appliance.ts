import { EventEmitter } from "node:events";
import { DeviceEnergyManagement } from "@matter/main/clusters/device-energy-management";
import { buildForecast, ForecastStep, stepAt, totalDurationS } from "../shared/forecast.js";
import { nowUnixS } from "../shared/time.js";
import { Settings } from "../shared/settings.js";

const { ForecastUpdateReason, OptOutState, AdjustmentCause } = DeviceEnergyManagement;

/** How long a start is held before running, giving an energy manager time to move it. */
export const START_HOLD_S = 60;
/** Default flexibility offered when no finish-by time is chosen. */
export const DEFAULT_FLEX_S = 12 * 3600;

export interface ProgramStep {
    minutes: number;
    watts: number;
    /** Index into the appliance's phase list. */
    phase: number;
}

export interface Program {
    id: number;
    name: string;
    /** Mode tags for the appliance's Mode cluster. */
    modeTags: number[];
    steps: ProgramStep[];
}

export type RunState = "idle" | "pending" | "running" | "paused";

export interface ApplianceSettings {
    programId: number;
    optIn: boolean;
    speed: number;
    energyWh: number;
    [key: string]: unknown;
}

/**
 * A program-driven appliance (dishwasher, washing machine) that offers a movable start time to an energy manager.
 *
 * The model is the single source of truth; the Matter endpoints and the web UI mirror it via the "change" event.
 */
export class ProgramAppliance<S extends ApplianceSettings = ApplianceSettings> extends EventEmitter {
    runState: RunState = "idle";
    /** Unix seconds the program will start (pending) or started (running, adjusted for pauses). */
    startUnixS = 0;
    originalStartUnixS = 0;
    earliestStartUnixS = 0;
    latestEndUnixS = 0;
    /** Unix seconds the user wants the program finished by, or null for the default flexibility. */
    finishByUnixS: number | null = null;
    canMoveStart = false;
    /** Simulated seconds of program progress. */
    elapsedS = 0;
    powerW = 0;
    forecastId = 0;
    forecastReason = ForecastUpdateReason.InternalOptimization;
    /** Bit flags from the DEM Mode cluster: which optimisation sources are permitted. */
    demAllowsLocal = true;
    demAllowsGrid = true;
    lastMessage = "";
    #forecast: DeviceEnergyManagement.Forecast | null = null;
    #lastSlot: number | null = null;
    #timer?: NodeJS.Timeout;

    constructor(
        readonly kind: string,
        readonly programs: Program[],
        readonly phases: string[],
        readonly settings: Settings<S>,
    ) {
        super();
    }

    get program() {
        return this.programs.find(p => p.id === this.settings.value.programId) ?? this.programs[0];
    }

    /** The power profile of the selected program; subclasses may adjust it for extra settings. */
    stepsFor(program: Program): ProgramStep[] {
        return program.steps;
    }

    get steps(): ProgramStep[] {
        return this.stepsFor(this.program);
    }

    get forecastSteps(): ForecastStep[] {
        return this.steps.map(s => ({ durationS: s.minutes * 60, watts: s.watts }));
    }

    get runtimeS() {
        return totalDurationS(this.forecastSteps);
    }

    get optOutState() {
        if (!this.settings.value.optIn) return OptOutState.OptOut;
        if (this.demAllowsLocal && this.demAllowsGrid) return OptOutState.NoOptOut;
        if (this.demAllowsLocal) return OptOutState.GridOptOut;
        if (this.demAllowsGrid) return OptOutState.LocalOptOut;
        return OptOutState.OptOut;
    }

    get currentStep() {
        if (this.runState !== "running" && this.runState !== "paused") return undefined;
        return stepAt(this.forecastSteps, this.elapsedS);
    }

    get currentPhase(): number | null {
        const current = this.currentStep;
        return current ? this.steps[current.index].phase : null;
    }

    /** Seconds until the program completes (including any pending delay). */
    get countdownS(): number | null {
        const now = nowUnixS();
        switch (this.runState) {
            case "pending":
                return Math.max(0, this.startUnixS - now) + this.runtimeS;
            case "running":
            case "paused":
                return Math.max(0, Math.round((this.runtimeS - this.elapsedS) / this.settings.value.speed));
            default:
                return null;
        }
    }

    get forecast() {
        return this.#forecast;
    }

    run() {
        this.#timer = setInterval(() => this.tick(), 1000);
        this.#publishForecast(ForecastUpdateReason.InternalOptimization);
    }

    close() {
        clearInterval(this.#timer);
    }

    // ---- User and Matter actions. Each returns an error message on failure. ----

    selectProgram(programId: number): string | undefined {
        if (this.runState !== "idle") return "Program is running";
        if (!this.programs.some(p => p.id === programId)) return "Unknown program";
        this.settings.update({ programId } as Partial<S>);
        this.#changed();
    }

    setOptIn(optIn: boolean) {
        this.settings.update({ optIn } as Partial<S>);
        if (this.runState === "pending") this.#publishForecast(ForecastUpdateReason.InternalOptimization);
        this.#changed();
    }

    setDemPermissions(local: boolean, grid: boolean) {
        this.demAllowsLocal = local;
        this.demAllowsGrid = grid;
        this.#changed();
    }

    setSpeed(speed: number) {
        this.settings.update({ speed: Math.max(1, Math.min(600, speed)) } as Partial<S>);
        this.#changed();
    }

    setFinishBy(unixS: number | null) {
        if (this.runState === "running" || this.runState === "paused") return "Program is running";
        this.finishByUnixS = unixS;
        this.#changed();
    }

    start(): string | undefined {
        if (this.runState === "paused") return this.resume();
        if (this.runState !== "idle") return "Program already started";
        const now = nowUnixS();
        this.canMoveStart = this.optOutState !== OptOutState.OptOut;
        if (this.canMoveStart) {
            const latestEnd = Math.max(this.finishByUnixS ?? now + DEFAULT_FLEX_S, now + START_HOLD_S + this.runtimeS);
            this.runState = "pending";
            this.startUnixS = this.originalStartUnixS = now + START_HOLD_S;
            this.earliestStartUnixS = now;
            this.latestEndUnixS = latestEnd;
            this.lastMessage = `Waiting ${START_HOLD_S}s for the energy manager to optimise the start`;
            this.#publishForecast(ForecastUpdateReason.InternalOptimization);
        } else {
            this.#beginRunning();
        }
        this.#changed();
    }

    stop(): string | undefined {
        if (this.runState === "idle") return;
        this.#reset();
        this.lastMessage = "Stopped";
        this.#changed();
    }

    pause(): string | undefined {
        if (this.runState !== "running") return "Program is not running";
        this.runState = "paused";
        this.powerW = 0;
        this.#changed();
    }

    resume(): string | undefined {
        if (this.runState !== "paused") return "Program is not paused";
        this.runState = "running";
        this.#publishForecast(ForecastUpdateReason.InternalOptimization);
        this.#changed();
    }

    /** Handles a DEM StartTimeAdjustRequest. requestedStartTime is in Unix seconds (matter.js converts epochs). */
    adjustStart(unixS: number, cause: DeviceEnergyManagement.AdjustmentCause): string | undefined {
        if (!this.settings.value.optIn) return "User has opted out of energy management";
        if (cause === AdjustmentCause.LocalOptimization && !this.demAllowsLocal) return "Local optimisation not permitted";
        if (cause === AdjustmentCause.GridOptimization && !this.demAllowsGrid) return "Grid optimisation not permitted";
        if (this.runState !== "pending" || !this.canMoveStart) return "Start time can only be moved before the program starts";

        const latestStart = this.latestEndUnixS - this.runtimeS;
        if (unixS < this.earliestStartUnixS || unixS > latestStart) {
            return `Requested start ${new Date(unixS * 1000).toISOString()} is outside the permitted window ` +
                `${new Date(this.earliestStartUnixS * 1000).toISOString()} – ${new Date(latestStart * 1000).toISOString()}`;
        }

        this.startUnixS = Math.max(unixS, nowUnixS());
        this.lastMessage = `Start moved to ${new Date(this.startUnixS * 1000).toLocaleTimeString()} by ${cause === AdjustmentCause.GridOptimization ? "grid" : "local"} optimisation`;
        this.#publishForecast(
            cause === AdjustmentCause.GridOptimization
                ? ForecastUpdateReason.GridOptimization
                : ForecastUpdateReason.LocalOptimization,
        );
        this.#changed();
    }

    /** Handles a DEM CancelRequest by restoring the device's own start time. */
    cancelAdjustment(): string | undefined {
        if (this.runState !== "pending") return "No adjustment to cancel";
        this.startUnixS = Math.max(this.originalStartUnixS, nowUnixS());
        this.lastMessage = "Adjustment cancelled";
        this.#publishForecast(ForecastUpdateReason.InternalOptimization);
        this.#changed();
    }

    /** Republishes a pending forecast after its power profile changed. */
    refreshForecast() {
        if (this.runState !== "pending") return;
        const now = nowUnixS();
        this.latestEndUnixS = Math.max(this.latestEndUnixS, this.startUnixS + this.runtimeS);
        this.startUnixS = Math.max(this.startUnixS, now);
        this.#publishForecast(ForecastUpdateReason.InternalOptimization);
    }

    // ---- Simulation ----

    tick() {
        const now = nowUnixS();
        if (this.runState === "pending" && now >= this.startUnixS) {
            this.#beginRunning();
            this.#changed();
            return;
        }
        if (this.runState !== "running") return;

        const speed = this.settings.value.speed;
        this.elapsedS += speed;
        const current = this.currentStep;
        if (!current) {
            const energyWh = this.settings.value.energyWh;
            this.#reset();
            this.lastMessage = `${this.program.name} complete`;
            this.emit("completed", { totalOperationalTime: Math.round(this.runtimeS), energyWh });
            this.#changed();
            return;
        }
        this.powerW = current.step.watts;
        // Energy is accumulated in simulated time so totals match the forecast.
        this.settings.update({ energyWh: this.settings.value.energyWh + (this.powerW * speed) / 3600 } as Partial<S>, false);
        if (current.index !== this.#lastSlot) {
            this.#publishForecast(ForecastUpdateReason.InternalOptimization);
        }
        this.#changed();
    }

    #beginRunning() {
        this.runState = "running";
        this.elapsedS = 0;
        this.startUnixS = nowUnixS();
        this.lastMessage = `${this.program.name} started`;
        this.#publishForecast(ForecastUpdateReason.InternalOptimization);
    }

    #reset() {
        this.runState = "idle";
        this.elapsedS = 0;
        this.powerW = 0;
        this.canMoveStart = false;
        this.finishByUnixS = null;
        this.settings.save();
        this.#publishForecast(ForecastUpdateReason.InternalOptimization);
    }

    #publishForecast(reason: DeviceEnergyManagement.ForecastUpdateReason) {
        if (this.runState === "idle") {
            this.#forecast = null;
            this.#lastSlot = null;
            return;
        }
        const running = this.runState === "running" || this.runState === "paused";
        const speed = this.settings.value.speed;
        this.forecastId++;
        this.forecastReason = reason;
        // While running, express the start in wall-clock time so the forecast end lines up with the countdown.
        const startUnixS = running ? nowUnixS() - Math.round(this.elapsedS / speed) : this.startUnixS;
        const steps = running && speed !== 1
            ? this.forecastSteps.map(s => ({ ...s, durationS: s.durationS / speed }))
            : this.forecastSteps;
        this.#forecast = buildForecast({
            forecastId: this.forecastId,
            steps,
            startUnixS,
            earliestStartUnixS: this.canMoveStart && !running ? this.earliestStartUnixS : undefined,
            latestEndUnixS: this.canMoveStart && !running ? this.latestEndUnixS : undefined,
            elapsedS: running ? this.elapsedS / speed : undefined,
            startTimeAdjustment: true,
            reason,
        });
        this.#lastSlot = this.#forecast.activeSlotNumber;
    }

    #changed() {
        this.emit("change");
    }

    /** Clears simulator state after a factory reset. */
    factoryReset() {
        this.#reset();
        this.settings.reset();
        this.forecastId = 0;
        this.demAllowsLocal = this.demAllowsGrid = true;
        this.lastMessage = "Factory reset";
        this.#changed();
    }

    snapshot() {
        const forecast = this.#forecast;
        return {
            kind: this.kind,
            runState: this.runState,
            program: this.program,
            programs: this.programs.map(p => ({ id: p.id, name: p.name, minutes: totalDurationS(this.stepsFor(p).map(s => ({ durationS: s.minutes * 60, watts: s.watts }))) / 60, kWh: this.stepsFor(p).reduce((sum, s) => sum + s.watts * s.minutes / 60000, 0) })),
            phases: this.phases,
            steps: this.steps,
            currentPhase: this.currentPhase,
            currentSlot: this.currentStep?.index ?? null,
            elapsedS: this.elapsedS,
            runtimeS: this.runtimeS,
            countdownS: this.countdownS,
            powerW: this.powerW,
            energyKWh: this.settings.value.energyWh / 1000,
            optIn: this.settings.value.optIn,
            optOutState: this.optOutState,
            speed: this.settings.value.speed,
            finishByUnixS: this.finishByUnixS,
            startUnixS: this.runState === "idle" ? null : this.startUnixS,
            earliestStartUnixS: this.canMoveStart ? this.earliestStartUnixS : null,
            latestEndUnixS: this.canMoveStart ? this.latestEndUnixS : null,
            forecast: forecast && {
                forecastId: forecast.forecastId,
                reason: ForecastUpdateReason[forecast.forecastUpdateReason],
                startUnixS: forecast.startTime,
                endUnixS: forecast.endTime,
                activeSlotNumber: forecast.activeSlotNumber,
                slots: forecast.slots.map(s => ({ durationS: s.defaultDuration, watts: Number(s.nominalPower ?? 0) / 1000 })),
            },
            message: this.lastMessage,
            settings: this.settings.value,
        };
    }
}
