import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Simulator settings persisted as JSON alongside the Matter storage. */
export class Settings<T extends object> {
    value: T;
    #dirty = false;
    #timer?: NodeJS.Timeout;

    constructor(readonly path: string, readonly defaults: T) {
        this.value = { ...defaults };
        if (existsSync(path)) {
            try {
                this.value = { ...defaults, ...JSON.parse(readFileSync(path, "utf8")) };
            } catch (error) {
                console.warn(`Ignoring unreadable settings file ${path}: ${error}`);
            }
        }
        // Flush periodically so frequently changing values (energy totals) don't hammer the disk.
        this.#timer = setInterval(() => this.#dirty && this.save(), 30_000);
        this.#timer.unref();
    }

    update(changes: Partial<T>, saveNow = true) {
        this.value = { ...this.value, ...changes };
        this.#dirty = true;
        if (saveNow) this.save();
    }

    save() {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.value, null, 2));
        this.#dirty = false;
    }

    reset() {
        this.value = { ...this.defaults };
        this.save();
    }
}
