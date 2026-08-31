import fs from "node:fs/promises";

import { chromium } from "playwright-core";

export class BrowserSession {
    constructor({ executablePath, profileDirectory }) {
        this.executablePath = executablePath;
        this.profileDirectory = profileDirectory;
        this.context = null;
        this.headless = null;
    }

    status() {
        return {
            running: Boolean(this.context),
            mode: this.context ? (this.headless ? "headless" : "visible") : "stopped",
            profileDirectory: this.profileDirectory,
        };
    }

    async ensure({ visible = false } = {}) {
        if (this.context && (!visible || this.headless === false)) {
            return this.context;
        }
        if (this.context) {
            await this.close();
        }
        await fs.mkdir(this.profileDirectory, { recursive: true });
        this.headless = !visible;
        const args = [
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-sync",
            "--no-first-run",
            "--no-default-browser-check",
        ];
        if (process.env.WAYLAND_DISPLAY) {
            args.push("--ozone-platform=wayland");
        }
        this.context = await chromium.launchPersistentContext(this.profileDirectory, {
            executablePath: this.executablePath,
            headless: this.headless,
            viewport: null,
            acceptDownloads: false,
            args,
        });
        this.context.once("close", () => {
            this.context = null;
            this.headless = null;
        });
        return this.context;
    }

    async page({ visible = false } = {}) {
        const context = await this.ensure({ visible });
        return context.newPage();
    }

    async open(url) {
        const context = await this.ensure({ visible: true });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.bringToFront();
        return page;
    }

    async close() {
        const context = this.context;
        this.context = null;
        this.headless = null;
        if (context) {
            await context.close();
        }
    }
}
