import { OperationalState } from "@matter/main/clusters/operational-state";
import { ModeBase } from "@matter/main/clusters/mode-base";
import type { ProgramAppliance } from "../sim/appliance.js";

const { OperationalStateEnum, ErrorState } = OperationalState;

/** Shared Matter state mappings for program-driven appliances (dishwasher, washing machine). */

export function operationalStateValues(appliance: ProgramAppliance) {
    const operationalState = {
        idle: OperationalStateEnum.Stopped,
        pending: OperationalStateEnum.Stopped,
        running: OperationalStateEnum.Running,
        paused: OperationalStateEnum.Paused,
    }[appliance.runState];
    return {
        operationalState,
        currentPhase: appliance.currentPhase ?? 0,
        countdownTime: appliance.countdownS,
    };
}

export function operationalStateInitial(appliance: ProgramAppliance) {
    return {
        operationalStateList: [
            { operationalStateId: OperationalStateEnum.Stopped },
            { operationalStateId: OperationalStateEnum.Running },
            { operationalStateId: OperationalStateEnum.Paused },
            { operationalStateId: OperationalStateEnum.Error },
        ],
        phaseList: appliance.phases,
        operationalError: { errorStateId: ErrorState.NoError },
        ...operationalStateValues(appliance),
    };
}

/** Converts a simulator action result into an OperationalState command response. */
export function commandResponse(error: string | undefined) {
    return {
        commandResponseState: error
            ? { errorStateId: ErrorState.CommandInvalidInState, errorStateDetails: error.slice(0, 64) }
            : { errorStateId: ErrorState.NoError },
    };
}

export function supportedModes(appliance: ProgramAppliance) {
    return appliance.programs.map(p => ({
        label: p.name,
        mode: p.id,
        modeTags: p.modeTags.map(value => ({ value })),
    }));
}

/** Validates and applies a ChangeToMode request against the simulator. */
export function changeToMode(appliance: ProgramAppliance, newMode: number): ModeBase.ChangeToModeResponse {
    const error = appliance.selectProgram(newMode);
    if (error === undefined) {
        return { status: ModeBase.ModeChangeStatus.Success, statusText: "" };
    }
    return {
        status: appliance.runState === "idle" ? ModeBase.ModeChangeStatus.UnsupportedMode : ModeBase.ModeChangeStatus.InvalidInMode,
        statusText: error,
    };
}
