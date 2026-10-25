import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server as SocketServer } from "socket.io";
import type { Commissioning } from "../shared/commissioning.js";

export interface Simulator {
    snapshot(): unknown;
    on(event: "change", listener: () => void): unknown;
    /** Applies a UI action; returns an error message on failure. */
    action(name: string, args: Record<string, unknown>): string | void | Promise<string | void>;
}

const require = createRequire(import.meta.url);
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const BOOTSTRAP_DIR = join(dirname(require.resolve("bootstrap/package.json")), "dist");

/**
 * Serves the UI (all assets local, so it works offline) and relays state and actions over socket.io.
 */
export function startWebServer(port: number, simulator: Simulator, commissioning: Commissioning) {
    const app = express();
    app.use(express.json());
    app.use("/vendor/bootstrap", express.static(BOOTSTRAP_DIR));
    app.use(express.static(PUBLIC_DIR));

    app.get("/api/state", (_req, res) => {
        res.json(simulator.snapshot());
    });
    app.get("/api/commissioning", async (_req, res) => {
        res.json(await commissioning.info());
    });

    const server = createServer(app);
    const io = new SocketServer(server);

    const broadcastCommissioning = async () => {
        try {
            io.emit("commissioning", await commissioning.info());
        } catch (error) {
            console.warn("Unable to read commissioning state", error);
        }
    };

    let queued = false;
    simulator.on("change", () => {
        if (queued) return;
        queued = true;
        setImmediate(() => {
            queued = false;
            io.emit("state", simulator.snapshot());
        });
    });

    io.on("connection", async socket => {
        socket.emit("state", simulator.snapshot());
        await broadcastCommissioning();

        socket.on("action", async ({ name, args }: { name: string; args?: Record<string, unknown> }, reply?: (result: { error?: string }) => void) => {
            try {
                const error = (await simulator.action(name, args ?? {})) ?? undefined;
                reply?.({ error });
            } catch (error) {
                reply?.({ error: String(error) });
            }
        });

        socket.on("openCommissioningWindow", async (reply?: (result: { error?: string }) => void) => {
            try {
                await commissioning.openWindow();
                reply?.({});
            } catch (error) {
                reply?.({ error: String(error) });
            }
            await broadcastCommissioning();
        });

        socket.on("factoryReset", async (reply?: (result: { error?: string }) => void) => {
            try {
                await commissioning.factoryReset();
                await simulator.action("factoryReset", {});
                reply?.({});
            } catch (error) {
                reply?.({ error: String(error) });
            }
            await broadcastCommissioning();
        });
    });

    // Commissioning changes (fabrics added/removed, window timing) are polled to keep the Settings tab current.
    setInterval(broadcastCommissioning, 5000).unref();

    server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
            console.error(`Port ${port} is already in use. Is another copy of this simulator running? Set WEB_PORT to use a different port.`);
            process.exit(1);
        }
        throw error;
    });
    server.listen(port, () => console.log(`Simulator UI on http://localhost:${port}`));
    return { io, server };
}
