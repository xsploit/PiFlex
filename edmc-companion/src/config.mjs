import os from "node:os";
import path from "node:path";

export const APP_VERSION = "0.1.0";
export const API_VERSION = 1;

export function dataDirectory(env = process.env) {
    if (env.BITEDJ_EDMC_DATA_DIR) {
        return path.resolve(env.BITEDJ_EDMC_DATA_DIR);
    }
    if (env.XDG_DATA_HOME) {
        return path.join(env.XDG_DATA_HOME, "bitedj-edmc");
    }
    if (process.platform === "win32" && env.LOCALAPPDATA) {
        return path.join(env.LOCALAPPDATA, "bitedj-edmc");
    }
    return path.join(os.homedir(), ".local", "share", "bitedj-edmc");
}

export function parseArguments(argv) {
    const options = {
        host: "127.0.0.1",
        port: 17642,
        openUi: false,
        usbRoot: null,
        chromiumExecutable:
            process.env.BITEDJ_EDMC_CHROMIUM || "/usr/bin/chromium",
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--ui") {
            options.openUi = true;
        } else if (argument === "--usb-root") {
            options.usbRoot = argv[++index] || null;
        } else if (argument === "--port") {
            options.port = Number(argv[++index]);
        } else if (argument === "--chromium") {
            options.chromiumExecutable = argv[++index] || null;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
        throw new Error("--port must be an integer from 1024 through 65535");
    }
    if (!options.chromiumExecutable) {
        throw new Error("A Chromium executable is required");
    }
    return options;
}
