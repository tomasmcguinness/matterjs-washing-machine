import { LaundryWasherMode } from "@matter/main/clusters/laundry-washer-mode";
import type { Program } from "./appliance.js";

const { ModeTag } = LaundryWasherMode;

export const PHASES = ["fill", "heat", "wash", "rinse", "spin"];
export const [FILL, HEAT, WASH, RINSE, SPIN] = PHASES.keys();

/** Temperature levels for the TemperatureControl cluster; the value is the water temperature in °C. */
export const TEMPERATURE_LEVELS = [
    { label: "Cold", celsius: 15 },
    { label: "20°C", celsius: 20 },
    { label: "30°C", celsius: 30 },
    { label: "40°C", celsius: 40 },
    { label: "60°C", celsius: 60 },
];
/** Cold-fill water temperature; heating time scales with the rise above this. */
export const INLET_CELSIUS = 15;

export const SPIN_SPEEDS = [400, 800, 1200, 1400];

export interface WasherProgram extends Program {
    /** Index into TEMPERATURE_LEVELS. */
    defaultTemperature: number;
    /** Index into SPIN_SPEEDS. */
    defaultSpin: number;
}

/**
 * Programs at their default temperature and spin. Heating dominates energy use, so the heat step changes most with
 * temperature; spin power scales with spin speed and extra rinses lengthen the rinse step.
 */
export const PROGRAMS: WasherProgram[] = [
    {
        id: 0,
        name: "Cotton 40",
        modeTags: [ModeTag.Normal],
        defaultTemperature: 3,
        defaultSpin: 3,
        steps: [
            { minutes: 5, watts: 80, phase: FILL },
            { minutes: 18, watts: 2100, phase: HEAT },
            { minutes: 60, watts: 180, phase: WASH },
            { minutes: 40, watts: 120, phase: RINSE },
            { minutes: 15, watts: 450, phase: SPIN },
        ],
    },
    {
        id: 1,
        name: "Cotton 60",
        modeTags: [ModeTag.Whites, ModeTag.Heavy],
        defaultTemperature: 4,
        defaultSpin: 3,
        steps: [
            { minutes: 5, watts: 80, phase: FILL },
            { minutes: 30, watts: 2100, phase: HEAT },
            { minutes: 70, watts: 180, phase: WASH },
            { minutes: 40, watts: 120, phase: RINSE },
            { minutes: 15, watts: 450, phase: SPIN },
        ],
    },
    {
        id: 2,
        name: "Eco 40-60",
        modeTags: [ModeTag.LowEnergy],
        defaultTemperature: 3,
        defaultSpin: 3,
        steps: [
            { minutes: 6, watts: 80, phase: FILL },
            { minutes: 25, watts: 1000, phase: HEAT },
            { minutes: 100, watts: 120, phase: WASH },
            { minutes: 45, watts: 110, phase: RINSE },
            { minutes: 18, watts: 420, phase: SPIN },
        ],
    },
    {
        id: 3,
        name: "Synthetics 40",
        modeTags: [ModeTag.Delicate],
        defaultTemperature: 3,
        defaultSpin: 1,
        steps: [
            { minutes: 4, watts: 80, phase: FILL },
            { minutes: 12, watts: 2000, phase: HEAT },
            { minutes: 45, watts: 150, phase: WASH },
            { minutes: 30, watts: 110, phase: RINSE },
            { minutes: 10, watts: 300, phase: SPIN },
        ],
    },
    {
        id: 4,
        name: "Quick 30",
        modeTags: [ModeTag.Quick],
        defaultTemperature: 2,
        defaultSpin: 2,
        steps: [
            { minutes: 3, watts: 80, phase: FILL },
            { minutes: 6, watts: 2000, phase: HEAT },
            { minutes: 12, watts: 200, phase: WASH },
            { minutes: 6, watts: 120, phase: RINSE },
            { minutes: 3, watts: 450, phase: SPIN },
        ],
    },
    {
        id: 5,
        name: "Wool 30",
        modeTags: [ModeTag.Delicate, ModeTag.Quiet],
        defaultTemperature: 2,
        defaultSpin: 1,
        steps: [
            { minutes: 4, watts: 80, phase: FILL },
            { minutes: 8, watts: 1800, phase: HEAT },
            { minutes: 25, watts: 90, phase: WASH },
            { minutes: 18, watts: 100, phase: RINSE },
            { minutes: 5, watts: 250, phase: SPIN },
        ],
    },
];
