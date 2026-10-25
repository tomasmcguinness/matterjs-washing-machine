import { DeviceEnergyManagement } from "@matter/main/clusters/device-energy-management";

/** One block of constant power in a forecast. */
export interface ForecastStep {
    /** Duration in seconds. */
    durationS: number;
    /** Nominal power in watts (negative for generation). */
    watts: number;
    /** Optional lower/upper power bounds in watts, defaulting to the nominal power. */
    minWatts?: number;
    maxWatts?: number;
}

export interface ForecastInput {
    forecastId: number;
    steps: ForecastStep[];
    /** Unix seconds. */
    startUnixS: number;
    /** Unix seconds, or undefined when the start can't be moved. */
    earliestStartUnixS?: number;
    /** Unix seconds, or undefined when the start can't be moved. */
    latestEndUnixS?: number;
    /**
     * Whether the cluster has StartTimeAdjustment, which makes the start window mandatory. A fixed start is then
     * reported as a window equal to the forecast itself.
     */
    startTimeAdjustment?: boolean;
    /** Seconds elapsed since startUnixS, or undefined when not yet running. */
    elapsedS?: number;
    reason: DeviceEnergyManagement.ForecastUpdateReason;
}

/** The Forecast struct allows at most this many slots. */
export const MAX_SLOTS = 10;

/**
 * Reduces steps to at most `max` by merging neighbours: first those with equal power, then repeatedly the adjacent
 * pair whose merge changes the profile least. Merged steps keep the energy-weighted average power. Profiles that
 * already fit are returned unchanged so slots stay aligned with program phases.
 */
export function limitSlots(steps: ForecastStep[], max = MAX_SLOTS): ForecastStep[] {
    if (steps.length <= max) return steps;

    const merge = (a: ForecastStep, b: ForecastStep): ForecastStep => {
        const durationS = a.durationS + b.durationS;
        return {
            durationS,
            watts: (a.watts * a.durationS + b.watts * b.durationS) / durationS,
            minWatts: Math.min(a.minWatts ?? a.watts, b.minWatts ?? b.watts),
            maxWatts: Math.max(a.maxWatts ?? a.watts, b.maxWatts ?? b.watts),
        };
    };

    const result: ForecastStep[] = [];
    for (const step of steps) {
        const last = result[result.length - 1];
        if (last && last.watts === step.watts && last.minWatts === step.minWatts && last.maxWatts === step.maxWatts) {
            result[result.length - 1] = merge(last, step);
        } else {
            result.push({ ...step });
        }
    }

    while (result.length > max) {
        let best = 0;
        let bestCost = Infinity;
        for (let i = 0; i < result.length - 1; i++) {
            const a = result[i];
            const b = result[i + 1];
            const cost = (Math.abs(a.watts - b.watts) * a.durationS * b.durationS) / (a.durationS + b.durationS);
            if (cost < bestCost) {
                bestCost = cost;
                best = i;
            }
        }
        result.splice(best, 2, merge(result[best], result[best + 1]));
    }
    return result.map(s => ({ ...s, watts: Math.round(s.watts) }));
}

export const totalDurationS = (steps: ForecastStep[]) => steps.reduce((sum, s) => sum + s.durationS, 0);
export const totalEnergyWh = (steps: ForecastStep[]) => steps.reduce((sum, s) => sum + (s.watts * s.durationS) / 3600, 0);

/** Finds the step active at the given elapsed time. */
export function stepAt(steps: ForecastStep[], elapsedS: number) {
    let offset = 0;
    for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        if (elapsedS < offset + step.durationS) {
            return { index, step, elapsedInStepS: elapsedS - offset };
        }
        offset += step.durationS;
    }
    return undefined;
}

/**
 * Builds a DEM Forecast struct. Slots are never pausable: the Pausable feature isn't offered, so slotIsPausable is
 * omitted as its conformance requires.
 */
export function buildForecast(input: ForecastInput): DeviceEnergyManagement.Forecast {
    const { startUnixS, elapsedS } = input;
    const steps = limitSlots(input.steps);
    const active = elapsedS === undefined ? undefined : stepAt(steps, elapsedS);

    let offset = 0;
    const slots = steps.map((step, index) => {
        const durationS = Math.round(step.durationS);
        let elapsedSlotTime = 0;
        let remainingSlotTime = durationS;
        if (elapsedS !== undefined) {
            elapsedSlotTime = Math.min(durationS, Math.max(0, Math.round(elapsedS - offset)));
            remainingSlotTime = durationS - elapsedSlotTime;
        }
        offset += step.durationS;
        return {
            minDuration: durationS,
            maxDuration: durationS,
            defaultDuration: durationS,
            elapsedSlotTime,
            remainingSlotTime,
            nominalPower: Math.round(step.watts * 1000),
            minPower: Math.round((step.minWatts ?? step.watts) * 1000),
            maxPower: Math.round((step.maxWatts ?? step.watts) * 1000),
            nominalEnergy: Math.round(step.watts * durationS / 3.6),
        };
    });

    const forecast: DeviceEnergyManagement.Forecast = {
        forecastId: input.forecastId,
        activeSlotNumber: active?.index ?? null,
        startTime: startUnixS,
        endTime: startUnixS + Math.round(totalDurationS(steps)),
        isPausable: false,
        slots,
        forecastUpdateReason: input.reason,
    };
    if (input.earliestStartUnixS !== undefined && input.latestEndUnixS !== undefined) {
        forecast.earliestStartTime = input.earliestStartUnixS;
        forecast.latestEndTime = input.latestEndUnixS;
    } else if (input.startTimeAdjustment) {
        forecast.earliestStartTime = forecast.startTime;
        forecast.latestEndTime = forecast.endTime;
    }
    return forecast;
}
