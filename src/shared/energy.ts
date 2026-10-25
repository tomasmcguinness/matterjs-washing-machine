import { Endpoint } from "@matter/main";
import { DeviceEnergyManagementModeServer } from "@matter/main/behaviors/device-energy-management-mode";
import { ElectricalEnergyMeasurementServer } from "@matter/main/behaviors/electrical-energy-measurement";
import { ElectricalPowerMeasurementServer } from "@matter/main/behaviors/electrical-power-measurement";
import { PowerTopologyServer } from "@matter/main/behaviors/power-topology";
import { DeviceEnergyManagementMode } from "@matter/main/clusters/device-energy-management-mode";
import { ElectricalPowerMeasurement } from "@matter/main/clusters/electrical-power-measurement";
import { MeasurementType } from "@matter/main/types";

const { ModeTag } = DeviceEnergyManagementMode;

export const VOLTAGE_MV = 230_000;

/** The five standard DEM modes. */
export const DEM_MODES = [
    { label: "No energy management", mode: 0, modeTags: [{ value: ModeTag.NoOptimization }] },
    { label: "Device optimisation", mode: 1, modeTags: [{ value: ModeTag.DeviceOptimization }] },
    { label: "Local optimisation", mode: 2, modeTags: [{ value: ModeTag.DeviceOptimization }, { value: ModeTag.LocalOptimization }] },
    { label: "Grid optimisation", mode: 3, modeTags: [{ value: ModeTag.DeviceOptimization }, { value: ModeTag.GridOptimization }] },
    {
        label: "Local and grid optimisation",
        mode: 4,
        modeTags: [{ value: ModeTag.DeviceOptimization }, { value: ModeTag.LocalOptimization }, { value: ModeTag.GridOptimization }],
    },
];
export const DEFAULT_DEM_MODE = 4;

/** Which optimisation sources a DEM mode permits. */
export function demModePermissions(mode: number) {
    const tags = DEM_MODES.find(m => m.mode === mode)?.modeTags.map(t => t.value) ?? [];
    return { local: tags.includes(ModeTag.LocalOptimization), grid: tags.includes(ModeTag.GridOptimization) };
}

/**
 * DEM Mode server that tells the simulator which optimisation sources are permitted.
 */
export function demModeServer(onChange: (mode: number) => void) {
    return class SimDemModeServer extends DeviceEnergyManagementModeServer {
        override initialize() {
            super.initialize();
            this.reactTo(this.events.currentMode$Changed, mode => onChange(mode));
            onChange(this.state.currentMode);
        }
    };
}

export const EnergyMeasurementServer = ElectricalEnergyMeasurementServer.with("CumulativeEnergy", "ImportedEnergy", "ExportedEnergy");
export const PowerMeasurementServer = ElectricalPowerMeasurementServer.with("AlternatingCurrent");
export const NodePowerTopologyServer = PowerTopologyServer.with("NodeTopology");

/** Initial state for an AC power measurement covering the given range in watts. */
export function powerMeasurementState(minW: number, maxW: number) {
    return {
        powerMode: ElectricalPowerMeasurement.PowerMode.Ac,
        numberOfMeasurementTypes: 3,
        accuracy: [
            {
                measurementType: MeasurementType.ActivePower,
                measured: true,
                minMeasuredValue: minW * 1000,
                maxMeasuredValue: maxW * 1000,
                accuracyRanges: [{ rangeMin: minW * 1000, rangeMax: maxW * 1000, percentMax: 200 }],
            },
            {
                measurementType: MeasurementType.Voltage,
                measured: true,
                minMeasuredValue: 200_000,
                maxMeasuredValue: 260_000,
                accuracyRanges: [{ rangeMin: 200_000, rangeMax: 260_000, percentMax: 100 }],
            },
            {
                measurementType: MeasurementType.ActiveCurrent,
                measured: true,
                minMeasuredValue: -Math.round((Math.abs(minW) * 1e6) / VOLTAGE_MV),
                maxMeasuredValue: Math.round((Math.abs(maxW) * 1e6) / VOLTAGE_MV),
                accuracyRanges: [{ rangeMin: -100_000, rangeMax: 100_000, percentMax: 200 }],
            },
        ],
        activePower: 0,
        voltage: VOLTAGE_MV,
        activeCurrent: 0,
    };
}

/** Converts watts to the EPM attributes; positive is consumption, negative is generation. */
export function powerValues(watts: number) {
    return {
        activePower: Math.round(watts * 1000),
        voltage: VOLTAGE_MV,
        activeCurrent: Math.round((watts * 1e6) / VOLTAGE_MV),
    };
}

/** Pushes the latest power and cumulative energy to an endpoint carrying the measurement clusters. */
export async function updateMeasurements(endpoint: Endpoint, watts: number, importedWh: number, exportedWh = 0) {
    await endpoint.setStateOf(PowerMeasurementServer, powerValues(watts));
    await endpoint.act(agent => {
        agent.get(EnergyMeasurementServer).setMeasurement({
            cumulativeEnergy: {
                imported: { energy: Math.round(importedWh * 1000) },
                exported: { energy: Math.round(exportedWh * 1000) },
            },
        });
    });
}

/** Initial state for cumulative energy measurement. */
export function energyMeasurementState() {
    return {
        accuracy: {
            measurementType: MeasurementType.ElectricalEnergy,
            measured: true,
            minMeasuredValue: 0,
            maxMeasuredValue: 1_000_000_000_000,
            accuracyRanges: [{ rangeMin: 0, rangeMax: 1_000_000_000_000, percentMax: 200 }],
        },
    };
}
