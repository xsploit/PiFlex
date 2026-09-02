import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createServer(companion) {
    return http.createServer(async (request, response) => {
        try {
            await route(companion, request, response);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { error: error?.message || String(error) });
        }
    });
}

async function route(companion, request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    const method = request.method || "GET";

    const requestOrigin = request.headers.origin;
    if (requestOrigin && requestOrigin !== companion.origin) {
        const error = new Error("Cross-origin requests are not allowed");
        error.statusCode = 403;
        throw error;
    }

    if (method === "GET" && url.pathname === "/v1/status") {
        return sendJson(response, 200, companion.status());
    }
    if (method === "GET" && url.pathname === "/v1/subscriptions") {
        return sendJson(response, 200, companion.subscriptions());
    }
    if (method === "PUT" && url.pathname === "/v1/subscriptions") {
        return sendJson(response, 200, await companion.setSubscriptions((await readBody(request)).subscriptions));
    }
    if (method === "POST" && url.pathname === "/v1/storage") {
        return sendJson(response, 200, await companion.setStorage((await readBody(request)).path));
    }
    if (method === "GET" && url.pathname === "/v1/settings") {
        return sendJson(response, 200, companion.settings());
    }
    if (method === "PUT" && url.pathname === "/v1/settings") {
        return sendJson(response, 200, await companion.setSettings(await readBody(request)));
    }
    if (method === "POST" && url.pathname === "/v1/ui/open") {
        return sendJson(response, 200, await companion.openUi());
    }
    if (method === "POST" && url.pathname === "/v1/auth/open") {
        return sendJson(response, 200, await companion.openAuthentication());
    }
    if (method === "POST" && url.pathname === "/v1/auth/check") {
        return sendJson(response, 202, companion.enqueueAuthCheck());
    }
    if (method === "POST" && url.pathname === "/v1/browser/close") {
        return sendJson(response, 200, await companion.closeBrowser());
    }
    if (method === "GET" && url.pathname === "/v1/releases") {
        return sendJson(response, 200, companion.releases());
    }
    if (method === "GET" && url.pathname === "/v1/catalog") {
        return sendJson(response, 200, companion.catalog());
    }
    if (method === "POST" && url.pathname === "/v1/catalog/refresh") {
        return sendJson(response, 202, companion.enqueueCatalogRefresh());
    }
    if (method === "GET" && url.pathname === "/v1/browse") {
        return sendJson(response, 200, companion.browse());
    }
    if (method === "POST" && url.pathname === "/v1/browse") {
        return sendJson(response, 202, companion.enqueueBrowse(await readBody(request)));
    }
    if (method === "POST" && url.pathname === "/v1/refresh") {
        return sendJson(response, 202, companion.enqueueRefresh((await readBody(request)).subscriptionId));
    }
    if (method === "POST" && url.pathname === "/v1/resolve") {
        return sendJson(response, 202, companion.enqueueResolve((await readBody(request)).topicId));
    }
    if (method === "POST" && url.pathname === "/v1/download") {
        const body = await readBody(request);
        return sendJson(response, 202, companion.enqueueDownload(body.topicId, body.providerId));
    }
    if (method === "GET" && url.pathname === "/v1/jobs") {
        return sendJson(response, 200, companion.jobs.list());
    }
    const cancelMatch = method === "POST" && url.pathname.match(/^\/v1\/jobs\/([^/]+)\/cancel$/);
    if (cancelMatch) {
        const cancelled = companion.jobs.cancel(cancelMatch[1]);
        return sendJson(response, cancelled ? 200 : 404, { cancelled });
    }

    if (method === "GET" && ["/", "/app.js", "/styles.css"].includes(url.pathname)) {
        const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
        const body = await fs.readFile(path.join(PUBLIC_ROOT, fileName));
        response.writeHead(200, {
            "content-type": contentTypes[path.extname(fileName)],
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        });
        response.end(body);
        return;
    }

    sendJson(response, 404, { error: "Not found" });
}

async function readBody(request) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1_048_576) {
            const error = new Error("Request body is too large");
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    if (chunks.length === 0) {
        return {};
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, value) {
    const body = `${JSON.stringify(value)}\n`;
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    });
    response.end(body);
}
