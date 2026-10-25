import { DeviceEnergyManagementServer } from "@matter/main/behaviors/device-energy-management";
import { DeviceEnergyManagement } from "@matter/main/clusters/device-energy-management";
import { Status, StatusResponseError } from "@matter/main/types";
import type { ProgramAppliance } from "../sim/appliance.js";

/** DEM with forecasts and start-time adjustment. Slots are never pausable, so Pausable is not offered. */
export const ProgramDemBase = DeviceEnergyManagementServer.with("PowerForecastReporting", "StartTimeAdjustment");

export function programDemServer(appliance: ProgramAppliance) {
    return class ProgramDemServer extends ProgramDemBase {
        override startTimeAdjustRequest({ requestedStartTime, cause }: DeviceEnergyManagement.StartTimeAdjustRequest) {
            const error = appliance.adjustStart(requestedStartTime, cause);
            if (error) {
                console.warn(`Rejected StartTimeAdjustRequest: ${error}`);
                throw new StatusResponseError(error, Status.ConstraintError);
            }
            this.state.forecast = appliance.forecast;
        }

        override cancelRequest() {
            const error = appliance.cancelAdjustment();
            if (error) {
                throw new StatusResponseError(error, Status.InvalidInState);
            }
            this.state.forecast = appliance.forecast;
        }
    };
}

export function programDemInitial(appliance: ProgramAppliance, esaType: DeviceEnergyManagement.EsaType, absMaxPowerW: number) {
    return {
        esaType,
        esaCanGenerate: false,
        esaState: DeviceEnergyManagement.EsaState.Online,
        absMinPower: 0,
        absMaxPower: absMaxPowerW * 1000,
        optOutState: appliance.optOutState,
        forecast: appliance.forecast,
    };
}
