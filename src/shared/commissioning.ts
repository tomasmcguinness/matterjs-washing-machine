import { CommissioningServer, ServerNode } from "@matter/main";
import QRCode from "qrcode";

/** How long a commissioning window opened from the UI stays open. */
const WINDOW_S = 180;

/** Pairing information and commissioning controls for the Settings tab. */
export class Commissioning {
    windowClosesAt: number | null = null;

    constructor(readonly node: ServerNode) {}

    async info() {
        const state = this.node.state.commissioning;
        if (state === undefined) {
            // The node is starting up or shutting down.
            return { online: false, commissioned: false, windowOpen: false, windowRemainingS: null, qrPairingCode: "", manualPairingCode: "", qrSvg: "", fabrics: [] };
        }
        const { commissioned, fabrics, pairingCodes } = state;
        if (this.windowClosesAt !== null && Date.now() > this.windowClosesAt) {
            this.windowClosesAt = null;
        }
        return {
            online: this.node.lifecycle.isOnline,
            commissioned,
            windowOpen: !commissioned || this.windowClosesAt !== null,
            windowRemainingS: this.windowClosesAt ? Math.round((this.windowClosesAt - Date.now()) / 1000) : null,
            qrPairingCode: pairingCodes.qrPairingCode,
            manualPairingCode: pairingCodes.manualPairingCode,
            qrSvg: await QRCode.toString(pairingCodes.qrPairingCode, { type: "svg", margin: 1 }),
            fabrics: Object.values(fabrics).map(f => ({
                fabricIndex: f.fabricIndex,
                label: f.label,
                vendorId: f.rootVendorId,
                nodeId: String(f.nodeId),
            })),
        };
    }

    async openWindow() {
        await this.node.act(agent => agent.get(CommissioningServer).enterCommissionableMode());
        this.windowClosesAt = Date.now() + WINDOW_S * 1000;
        setTimeout(() => (this.windowClosesAt = null), WINDOW_S * 1000).unref();
    }

    /** Erases fabrics and storage then brings the node back up ready to commission again. */
    async factoryReset() {
        this.windowClosesAt = null;
        await this.node.erase();
        if (!this.node.lifecycle.isOnline) {
            await this.node.start();
        }
    }
}
