import { Endpoint, ServerNode } from "@matter/main";
import { DescriptorServer } from "@matter/main/behaviors/descriptor";
import { ModeBase } from "@matter/main/clusters/mode-base";
import { LaundryWasherDevice, LaundryWasherRequirements } from "@matter/main/devices/laundry-washer";
import { LaundryWasherControls } from "@matter/main/clusters/laundry-washer-controls";
import { Status, StatusResponseError } from "@matter/main/types";
import { DeviceEnergyManagementEndpoint } from "@matter/main/endpoints/device-energy-management";
import { DeviceEnergyManagement } from "@matter/main/clusters/device-energy-management";
import { DEFAULT_DEM_MODE, DEM_MODES, demModePermissions, demModeServer, energyMeasurementState, EnergyMeasurementServer, NodePowerTopologyServer, PowerMeasurementServer, powerMeasurementState, updateMeasurements } from "../shared/energy.js";
import { ElectricalSensorEndpoint } from "@matter/main/endpoints/electrical-sensor";
import type { WasherAppliance } from "../sim/washer.js";
import { SPIN_SPEEDS, TEMPERATURE_LEVELS } from "../sim/programs.js";
import { changeToMode, commandResponse, operationalStateInitial, operationalStateValues, supportedModes } from "./program-clusters.js";
import { programDemInitial, programDemServer } from "./program-dem.js";

/**
 * Endpoint 1 is the laundry washer; endpoint 2 is Device Energy Management plus Electrical Sensor, matching the
 * dishwasher simulator's layout.
 */
export async function addEndpoints(node: ServerNode, appliance: WasherAppliance) {
    class OperationalStateServer extends LaundryWasherRequirements.OperationalStateServer {
        override start() {
            return this.#apply(appliance.start());
        }
        override stop() {
            return this.#apply(appliance.stop());
        }
        override pause() {
            return this.#apply(appliance.pause());
        }
        override resume() {
            return this.#apply(appliance.resume());
        }
        #apply(error: string | undefined) {
            if (!error) Object.assign(this.state, operationalStateValues(appliance));
            return commandResponse(error);
        }
    }

    class ModeServer extends LaundryWasherRequirements.LaundryWasherModeServer {
        override changeToMode({ newMode }: ModeBase.ChangeToModeRequest) {
            const result = changeToMode(appliance, newMode);
            if (result.status === ModeBase.ModeChangeStatus.Success) this.state.currentMode = newMode;
            return result;
        }
    }

    class ControlsServer extends LaundryWasherRequirements.LaundryWasherControlsServer.with("Spin", "Rinse") {
        override initialize() {
            // Spin speed and rinse count are writable attributes; mirror client writes into the simulator.
            this.reactTo(this.events.spinSpeedCurrent$Changing, (spin, _old, context) => {
                if (!context.offline && spin !== null) this.#apply(appliance.setOptions({ spin }));
            });
            this.reactTo(this.events.numberOfRinses$Changing, (rinses, _old, context) => {
                if (!context.offline) this.#apply(appliance.setOptions({ rinses: rinsesToIndex(rinses) }));
            });
        }
        #apply(error: string | undefined) {
            if (error) throw new StatusResponseError(error, Status.InvalidInState);
        }
    }

    class TemperatureServer extends LaundryWasherRequirements.TemperatureControlServer.with("TemperatureLevel") {
        override setTemperature({ targetTemperatureLevel }: { targetTemperatureLevel?: number }) {
            if (targetTemperatureLevel === undefined || !TEMPERATURE_LEVELS[targetTemperatureLevel]) {
                throw new StatusResponseError("Unsupported temperature level", Status.ConstraintError);
            }
            const error = appliance.setOptions({ temperature: targetTemperatureLevel });
            if (error) throw new StatusResponseError(error, Status.InvalidInState);
            this.state.selectedTemperatureLevel = targetTemperatureLevel;
        }
    }

    const washer = new Endpoint(
        LaundryWasherDevice.with(OperationalStateServer, ModeServer, ControlsServer, TemperatureServer, LaundryWasherRequirements.IdentifyServer),
        {
            id: "washer",
            number: 1,
            operationalState: operationalStateInitial(appliance),
            laundryWasherMode: { supportedModes: supportedModes(appliance), currentMode: appliance.program.id },
            laundryWasherControls: {
                spinSpeeds: SPIN_SPEEDS.map(rpm => `${rpm} rpm`),
                spinSpeedCurrent: appliance.settings.value.spin,
                numberOfRinses: indexToRinses(appliance.settings.value.rinses),
                supportedRinses: [NumberOfRinses.Normal, NumberOfRinses.Extra, NumberOfRinses.Max],
            },
            temperatureControl: {
                supportedTemperatureLevels: TEMPERATURE_LEVELS.map(t => t.label),
                selectedTemperatureLevel: appliance.settings.value.temperature,
            },
        },
    );
    await node.add(washer);

    const energy = new Endpoint(
        DeviceEnergyManagementEndpoint.with(
            DescriptorServer,
            programDemServer(appliance),
            demModeServer(mode => {
                const { local, grid } = demModePermissions(mode);
                appliance.setDemPermissions(local, grid);
            }),
            PowerMeasurementServer,
            EnergyMeasurementServer,
            NodePowerTopologyServer,
        ),
        {
            id: "energy",
            number: 2,
            descriptor: {
                deviceTypeList: [
                    { deviceType: DeviceEnergyManagementEndpoint.deviceType, revision: DeviceEnergyManagementEndpoint.deviceRevision },
                    { deviceType: ElectricalSensorEndpoint.deviceType, revision: ElectricalSensorEndpoint.deviceRevision },
                ],
            },
            deviceEnergyManagement: programDemInitial(appliance, DeviceEnergyManagement.EsaType.WashingMachine, 2300),
            deviceEnergyManagementMode: { supportedModes: DEM_MODES, currentMode: DEFAULT_DEM_MODE },
            electricalPowerMeasurement: powerMeasurementState(0, 2300),
            electricalEnergyMeasurement: energyMeasurementState(),
            powerTopology: {},
        },
    );
    await node.add(energy);

    return { washer, energy };
}

/** Mirrors simulator changes onto the Matter endpoints. Updates are serialised and coalesced. */
export function bindEndpoints(appliance: WasherAppliance, endpoints: { washer: Endpoint; energy: Endpoint }) {
    const { washer, energy } = endpoints;
    let pending = false;
    let running: Promise<void> = Promise.resolve();
    let lastPowerW = -1;
    let lastEnergyPush = 0;

    const push = async () => {
        pending = false;
        const { temperature, spin, rinses } = appliance.settings.value;
        await washer.set({
            operationalState: operationalStateValues(appliance),
            laundryWasherMode: { currentMode: appliance.program.id },
            laundryWasherControls: { spinSpeedCurrent: spin, numberOfRinses: indexToRinses(rinses) },
            temperatureControl: { selectedTemperatureLevel: temperature },
        } as never);
        await energy.set({
            deviceEnergyManagement: { forecast: appliance.forecast, optOutState: appliance.optOutState },
        } as never);
        // Power is pushed when it changes; cumulative energy at most every 10 s to keep event traffic down.
        const now = Date.now();
        if (appliance.powerW !== lastPowerW || now - lastEnergyPush > 10_000) {
            lastPowerW = appliance.powerW;
            lastEnergyPush = now;
            await updateMeasurements(energy, appliance.powerW, appliance.settings.value.energyWh);
        }
    };

    appliance.on("change", () => {
        if (pending) return;
        pending = true;
        running = running.then(push).catch(error => {
            // Updates racing a factory reset are dropped; the reset publishes fresh state once the node is back.
            if (!washer.lifecycle.isReady || !energy.lifecycle.isReady) return;
            console.error("Failed to update Matter state", error);
        });
    });

    appliance.on("completed", ({ totalOperationalTime }: { totalOperationalTime: number }) => {
        Promise.resolve(washer.act(agent => {
                agent.get(LaundryWasherRequirements.OperationalStateServer).events.operationCompletion.emit(
                    { completionErrorCode: 0, totalOperationalTime, pausedTime: 0 },
                    agent.context,
                );
            }))
            .catch((error: unknown) => console.error("Failed to emit OperationCompletion", error));
    });
}

const { NumberOfRinses } = LaundryWasherControls;

/** The simulator's rinse options are Normal, Extra and Max; None isn't offered. */
function indexToRinses(index: number) {
    return [NumberOfRinses.Normal, NumberOfRinses.Extra, NumberOfRinses.Max][index] ?? NumberOfRinses.Normal;
}

function rinsesToIndex(rinses: LaundryWasherControls.NumberOfRinses) {
    return Math.max(0, [NumberOfRinses.Normal, NumberOfRinses.Extra, NumberOfRinses.Max].indexOf(rinses));
}
