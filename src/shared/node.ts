import { resolve } from "node:path";
import { DeviceTypeId, Environment, Logger, ServerNode, VendorId } from "@matter/main";

export interface NodeIdentity {
    id: string;
    name: string;
    productId: number;
    deviceType: number;
    port: number;
    discriminator: number;
    passcode: number;
    serialNumber: string;
}

/** Storage lives in the repo so each simulator keeps its own fabrics, separate from ~/.matter. */
export const STORAGE_PATH = resolve(process.env.MATTER_STORAGE_PATH ?? ".matter-storage");

export async function createServerNode(identity: NodeIdentity) {
    Environment.default.vars.set("storage.path", STORAGE_PATH);
    if (!process.env.MATTER_LOG_LEVEL) Logger.level = "info";

    return ServerNode.create({
        id: identity.id,
        network: { port: identity.port },
        commissioning: { passcode: identity.passcode, discriminator: identity.discriminator },
        productDescription: { name: identity.name, deviceType: DeviceTypeId(identity.deviceType) },
        basicInformation: {
            vendorName: "Matter.js Simulators",
            vendorId: VendorId(0xfff1),
            nodeLabel: identity.name,
            productName: identity.name,
            productLabel: identity.name,
            productId: identity.productId,
            serialNumber: identity.serialNumber,
            uniqueId: `${identity.id}-${identity.serialNumber}`,
            hardwareVersion: 1,
            hardwareVersionString: "1.0",
            softwareVersion: 1,
            softwareVersionString: "0.1.0",
        },
    });
}
