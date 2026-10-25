import { join } from "node:path";
import { LaundryWasherDevice } from "@matter/main/devices/laundry-washer";
import { Commissioning } from "./shared/commissioning.js";
import { createServerNode, STORAGE_PATH } from "./shared/node.js";
import { Settings } from "./shared/settings.js";
import { WasherAppliance, WasherSettings } from "./sim/washer.js";
import { PHASES, PROGRAMS } from "./sim/programs.js";
import { addEndpoints, bindEndpoints } from "./matter/device.js";
import { startWebServer } from "./web/server.js";

const WEB_PORT = Number(process.env.WEB_PORT ?? 7001);
const MATTER_PORT = Number(process.env.MATTER_PORT ?? 5543);

const settings = new Settings<WasherSettings>(join(STORAGE_PATH, "simulator.json"), {
    programId: 0,
    optIn: true,
    speed: 1,
    energyWh: 0,
    temperature: PROGRAMS[0].defaultTemperature,
    spin: PROGRAMS[0].defaultSpin,
    rinses: 0,
});
const appliance = new WasherAppliance("washing-machine", PROGRAMS, PHASES, settings);

const node = await createServerNode({
    id: "washing-machine",
    name: "Simulated Washing Machine",
    productId: 0x8003,
    deviceType: LaundryWasherDevice.deviceType,
    port: MATTER_PORT,
    discriminator: 3843,
    passcode: 20202023,
    serialNumber: "SIM-WM-0001",
});
const endpoints = await addEndpoints(node, appliance);
bindEndpoints(appliance, endpoints);

const commissioning = new Commissioning(node);
startWebServer(WEB_PORT, {
    snapshot: () => appliance.snapshot(),
    on: (event, listener) => appliance.on(event, listener),
    action(name, args) {
        switch (name) {
            case "selectProgram": return appliance.selectProgram(Number(args.programId));
            case "setOptIn": return appliance.setOptIn(Boolean(args.optIn));
            case "setOptions": return appliance.setOptions(args as { temperature?: number; spin?: number; rinses?: number });
            case "setSpeed": return appliance.setSpeed(Number(args.speed));
            case "setFinishBy": return appliance.setFinishBy(args.finishByUnixS === null ? null : Number(args.finishByUnixS));
            case "start": return appliance.start();
            case "stop": return appliance.stop();
            case "pause": return appliance.pause();
            case "resume": return appliance.resume();
            case "factoryReset": return appliance.factoryReset();
            default: return `Unknown action ${name}`;
        }
    },
}, commissioning);

appliance.run();
await node.start();

const { qrPairingCode, manualPairingCode } = node.state.commissioning.pairingCodes;
console.log(`Manual pairing code: ${manualPairingCode}  QR: ${qrPairingCode}`);
