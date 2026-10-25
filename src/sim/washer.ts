import { ApplianceSettings, Program, ProgramAppliance, ProgramStep } from "./appliance.js";
import { HEAT, INLET_CELSIUS, PROGRAMS, RINSE, SPIN, SPIN_SPEEDS, TEMPERATURE_LEVELS, WasherProgram } from "./programs.js";

/** Rinse count options matching the LaundryWasherControls NumberOfRinses enum (Normal, Extra, Max). */
export const RINSES = [
    { label: "Normal", factor: 1 },
    { label: "Extra", factor: 1.5 },
    { label: "Max", factor: 2 },
];

export interface WasherSettings extends ApplianceSettings {
    temperature: number;
    spin: number;
    /** 0 Normal, 1 Extra, 2 Max. */
    rinses: number;
}

/** A washing machine whose forecast follows the chosen temperature, spin speed and rinse count. */
export class WasherAppliance extends ProgramAppliance<WasherSettings> {
    override stepsFor(program: Program): ProgramStep[] {
        const washer = program as WasherProgram;
        const { temperature, spin, rinses } = this.optionsFor(washer);
        const defaultRise = TEMPERATURE_LEVELS[washer.defaultTemperature].celsius - INLET_CELSIUS;
        const rise = TEMPERATURE_LEVELS[temperature].celsius - INLET_CELSIUS;

        return program.steps
            .map(step => {
                switch (step.phase) {
                    case HEAT:
                        return { ...step, minutes: Math.round((step.minutes * rise) / defaultRise) };
                    case RINSE:
                        return { ...step, minutes: Math.round(step.minutes * RINSES[rinses].factor) };
                    case SPIN:
                        return { ...step, watts: Math.round((step.watts * SPIN_SPEEDS[spin]) / SPIN_SPEEDS[washer.defaultSpin]) };
                    default:
                        return step;
                }
            })
            .filter(step => step.minutes > 0);
    }

    /** Options apply to the selected program; other programs are shown at their defaults. */
    optionsFor(program: WasherProgram) {
        const { programId, temperature, spin, rinses } = this.settings.value;
        if (program.id === programId) return { temperature, spin, rinses };
        return { temperature: program.defaultTemperature, spin: program.defaultSpin, rinses: 0 };
    }

    override selectProgram(programId: number) {
        const error = super.selectProgram(programId);
        if (error) return error;
        const program = PROGRAMS.find(p => p.id === programId)!;
        this.settings.update({ temperature: program.defaultTemperature, spin: program.defaultSpin, rinses: 0 });
        this.emit("change");
    }

    setOptions(options: Partial<Pick<WasherSettings, "temperature" | "spin" | "rinses">>) {
        if (this.runState === "running" || this.runState === "paused") return "Options can't change while running";
        if (options.temperature !== undefined && !TEMPERATURE_LEVELS[options.temperature]) return "Unknown temperature";
        if (options.spin !== undefined && !SPIN_SPEEDS[options.spin]) return "Unknown spin speed";
        if (options.rinses !== undefined && !RINSES[options.rinses]) return "Unknown rinse option";
        this.settings.update(options);
        this.refreshForecast();
        this.emit("change");
    }

    override snapshot() {
        return {
            ...super.snapshot(),
            temperatureLevels: TEMPERATURE_LEVELS.map(t => t.label),
            spinSpeeds: SPIN_SPEEDS,
            rinseOptions: RINSES.map(r => r.label),
            temperature: this.settings.value.temperature,
            spin: this.settings.value.spin,
            rinses: this.settings.value.rinses,
        };
    }
}
