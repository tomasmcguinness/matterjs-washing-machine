# matterjs-washing-machine

A [matter.js](https://github.com/project-chip/matter.js) washing machine simulator for developing energy managers. It exposes a Laundry Washer with a **Device Energy Management** forecast that follows the chosen program, temperature, spin speed and rinse count. It accepts **start-time adjustment** requests and runs as one Node process.

It is one of four simulators that also include [matterjs-dishwasher](https://github.com/tomasmcguinness/matterjs-dishwasher), [matterjs-heat-pump](https://github.com/tomasmcguinness/matterjs-heat-pump) and [matterjs-solar-inverter](https://github.com/tomasmcguinness/matterjs-solar-inverter). They are built to work with [matter-js-energy-manager](https://github.com/tomasmcguinness/matter-js-energy-manager).

## Running

Requires Node.js 20.19+ or 22.13+ (required by matter.js).

```bash
npm install
npm run dev
```

Open the UI at `http://localhost:7001`. Every asset (Bootstrap, socket.io and the QR code renderer) is served from `node_modules`, so the UI works with no internet connection.

| Setting | Default | Environment variable |
|---|---|---|
| Web UI port | 7001 | `WEB_PORT` |
| Matter port | 5543 | `MATTER_PORT` |
| Storage | `./.matter-storage` | `MATTER_STORAGE_PATH` |
| Log level | `info` | `MATTER_LOG_LEVEL` |

`npm run build` compiles to `dist/`, and `npm start` runs the compiled build.

## Commissioning

| | |
|---|---|
| Manual pairing code | `3497-031-2335` |
| QR payload | `MT:29801YDA13I.0648G00` |
| Passcode / discriminator | `20202023` / `3843` |
| Vendor / product ID | `0xFFF1` (test vendor) / `0x8003` |

The **Settings** tab shows the QR code and the fabrics the device belongs to. It has two actions:

- **Open commissioning window** opens a window so another controller can join.
- **Factory reset** erases all fabrics, Matter storage and simulator settings, then restarts the node uncommissioned.

## Conventions

- **Power sign:** Electrical Power Measurement `activePower` is positive when the device consumes power and negative when it produces it. Units are mW, mV and mA.
- **Time:** matter.js takes epoch-s values (forecast start/end and `requestedStartTime`) as **Unix seconds** and converts them to the Matter epoch on the wire. Controllers built on matter.js should send Unix seconds too.
- **Forecast size:** forecasts have at most 10 slots, the limit in the Matter specification.

## Endpoints

| Endpoint | Device types | Clusters |
|---|---|---|
| 0 | Root Node | standard root clusters |
| 1 | Laundry Washer (0x0073) | Identify, Operational State, Laundry Washer Mode (one mode per program), Laundry Washer Controls (Spin, Rinse; writable `spinSpeedCurrent` and `numberOfRinses`), Temperature Control (TemperatureLevel: Cold, 20, 30, 40 and 60 °C; `SetTemperature`) |
| 2 | Device Energy Management (0x050D) + Electrical Sensor (0x0510) | Device Energy Management (PFR, STA), Device Energy Management Mode, Electrical Power Measurement, Electrical Energy Measurement, Power Topology |

## Programs

Each program has five phases (`fill`, `heat`, `wash`, `rinse`, `spin`), and each phase becomes one forecast slot.

| Program | Default temp / spin | Steps (minutes × W) | Duration | Energy |
|---|---|---|---|---|
| Cotton 40 | 40 °C / 1400 | fill 5×80, heat 18×2100, wash 60×180, rinse 40×120, spin 15×450 | 2 h 18 | 1.0 kWh |
| Cotton 60 | 60 °C / 1400 | fill 5×80, heat 30×2100, wash 70×180, rinse 40×120, spin 15×450 | 2 h 40 | 1.46 kWh |
| Eco 40-60 | 40 °C / 1400 | fill 6×80, heat 25×1000, wash 100×120, rinse 45×110, spin 18×420 | 3 h 14 | 0.83 kWh |
| Synthetics 40 | 40 °C / 800 | fill 4×80, heat 12×2000, wash 45×150, rinse 30×110, spin 10×300 | 1 h 41 | 0.62 kWh |
| Quick 30 | 30 °C / 1200 | fill 3×80, heat 6×2000, wash 12×200, rinse 6×120, spin 3×450 | 30 min | 0.28 kWh |
| Wool 30 | 30 °C / 800 | fill 4×80, heat 8×1800, wash 25×90, rinse 18×100, spin 5×250 | 1 h | 0.33 kWh |

The options reshape the forecast:

- **Temperature** scales the heat step by the temperature rise above a 15 °C cold fill. *Cold* removes the heat step.
- **Spin speed** scales spin power.
- **Extra** and **Max** rinses lengthen the rinse step by 1.5× and 2×.

Selecting a program resets the options to that program's defaults. The options can be changed from the UI or over Matter while the machine isn't running.

## Device Energy Management

The DEM cluster on endpoint 2 has the **PowerForecastReporting** and **StartTimeAdjustment** features. **Pausable** isn't offered, so forecast slots can never be paused. Each forecast slot is one program step, with fixed duration and power (min = default = max).

1. **Start.** Press *Start* in the UI, or send OperationalState `Start`.
   - **Opted in:** the program waits 60 s before it runs. It publishes a forecast with `earliestStartTime` = now and `latestEndTime` = *Finish by*, which defaults to now + 12 h. OperationalState stays *Stopped* while `countdownTime` counts down to the end of the program.
   - **Opted out:** the program starts at once. The forecast window then equals the forecast itself, so it can't move.
2. **`StartTimeAdjustRequest`.** A request is accepted when it starts within `[earliestStartTime, latestEndTime − duration]` and before the program begins. An accepted request moves the start and publishes a new `forecastId` with reason `LocalOptimization` or `GridOptimization`. Anything else returns `CONSTRAINT_ERROR`.
3. **`CancelRequest`.** Restores the device's own start time.
4. **Running.** `activeSlotNumber` and the slot elapsed/remaining times update at each slot boundary. When the program completes, the device emits the `OperationCompletion` event and sets the forecast to null.

**Opt-in** combines the UI switch with the DEM Mode cluster:

- *No energy management* and *Device optimisation* give `OptOut`.
- *Local* or *Grid* opt out of the other source.
- *Local and grid optimisation* is the default.

The **simulation speed** on the Settings tab (1× to 300×) speeds up running programs. Forecast durations are scaled to match.

## UI

- **Main tab:**
  - an outline drawing whose drum turns slowly while washing, back and forth while rinsing, and fast while spinning, with the water level rising during the fill;
  - program, temperature, spin, rinses and *Finish by* selection, the opt-in switch, and Start, Pause, Resume and Stop buttons;
  - live status and the published forecast.
- **Settings tab:** commissioning, simulation speed and factory reset.

## Project layout

```
src/
  main.ts                 boots the simulator, Matter node and web server
  sim/appliance.ts        program-driven appliance model: start window, adjustments, run and complete
  sim/programs.ts         program definitions
  matter/device.ts        endpoints and the bridge from the model to Matter state
  matter/program-*.ts     OperationalState, Mode and DEM behaviour shared with the other appliance simulator
  shared/                 forecast builder, energy clusters, commissioning, node setup, settings (shared with the sibling simulators)
  web/server.ts           Express and socket.io UI server
public/                   index.html (drawing and controls), app.js, common.js (Settings tab, charts), style.css
```
