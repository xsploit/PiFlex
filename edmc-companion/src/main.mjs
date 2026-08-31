import path from "node:path";

import { Companion } from "./companion.mjs";
import { dataDirectory, parseArguments } from "./config.mjs";
import { createServer } from "./server.mjs";

const options = parseArguments(process.argv.slice(2));
const origin = `http://${options.host}:${options.port}`;
const companion = new Companion({
    dataDir: dataDirectory(),
    chromiumExecutable: path.resolve(options.chromiumExecutable),
    usbRoot: options.usbRoot,
    origin,
});
await companion.initialize();

const server = createServer(companion);
await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
});
console.log(`BiteDJ EDMC companion listening on ${origin}`);

if (options.openUi) {
    await companion.openUi();
}

async function shutdown(signal) {
    console.log(`Stopping after ${signal}`);
    await companion.browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
