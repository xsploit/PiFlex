import fs from "node:fs/promises";
import path from "node:path";
import { UsbLibrary } from "./usb-library.mjs";

const unescapeMount = (value) => value.replace(/\\([0-7]{3})/g,
    (_, octal) => String.fromCharCode(parseInt(octal, 8)));

export function parseMountInfo(text) {
    return text.trim().split("\n").filter(Boolean).map((line) => {
        const [before, after] = line.split(" - ");
        const fields = before.split(" ");
        const [type, source] = (after || "").split(" ");
        return { mountId: fields[0], device: fields[2], rootPath: unescapeMount(fields[4]),
            writable: fields[5].split(",").includes("rw"), type, source: unescapeMount(source || "") };
    });
}

async function handleMountId(handle) {
    const info = await fs.readFile(`/proc/self/fdinfo/${handle.fd}`, "utf8");
    const id = /^mnt_id:\s*(\d+)$/m.exec(info)?.[1];
    if (!id) throw new Error("Cannot establish the mounted filesystem identity");
    return id;
}

async function pathMountId(rootPath) {
    const handle = await fs.open(rootPath, "r");
    try { return await handleMountId(handle); }
    finally { await handle.close(); }
}

// mountinfo can contain stacked mounts at the SAME pathname. Ordering is not
// proof of visibility: the kernel's fdinfo identifies the one actually opened.
export async function visibleMounts(mounts, readMountId = pathMountId) {
    const roots = [...new Set(mounts.map((m) => m.rootPath))];
    const visible = await Promise.all(roots.map(async (rootPath) => {
        const mountId = await readMountId(rootPath).catch(() => null);
        return mounts.find((m) => m.rootPath === rootPath && m.mountId === mountId);
    }));
    return visible.filter(Boolean); // disappearance/overmount requires a fresh scan
}

export async function mountedUsbVolumes() {
    if (process.platform !== "linux") return [];
    const mounts = parseMountInfo(await fs.readFile("/proc/self/mountinfo", "utf8"));
    const bootId = (await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
    const uuids = new Map();
    for (const uuid of await fs.readdir("/dev/disk/by-uuid").catch(() => [])) {
        const device = await fs.realpath(path.join("/dev/disk/by-uuid", uuid)).catch(() => null);
        if (device) uuids.set(device, uuid);
    }
    const visible = await visibleMounts(mounts.filter((m) => /^\/(?:media|run\/media)\//.test(m.rootPath) &&
        m.source.startsWith("/dev/")));
    return Promise.all(visible.map(async (m) => {
        const source = await fs.realpath(m.source).catch(() => m.source);
        // Without a filesystem UUID, require reselection after reboot/replug.
        // /dev/sdb1 alone can refer to an entirely different stick next time.
        const id = uuids.has(source) ? `uuid:${uuids.get(source)}` : `session:${bootId}:${m.mountId}:${source}`;
        return { ...m, id, instance: `${id}:${m.mountId}`, kind: "usb", label: path.basename(m.rootPath) };
    }));
}

// A selected path is not proof of a mounted drive. Keep identity and a mount
// instance separately: the former survives reboot, the latter detects replug.
export class Storage {
    constructor(dataDir, { enumerate = mountedUsbVolumes, pin = process.platform === "linux", statfs = fs.statfs } = {}) {
        this.localRoot = path.resolve(dataDir, "sd-library");
        this.enumerate = enumerate;
        this.pin = pin;
        this.statfs = statfs;
        this.blocked = new Set();
    }

    async volumes() {
        const usb = await this.enumerate();
        // Do not keep an eject exclusion after this mount instance disappears.
        for (const instance of this.blocked) {
            if (!usb.some((v) => v.instance === instance)) this.blocked.delete(instance);
        }
        return [{ rootPath: this.localRoot, id: "sd", instance: "sd", kind: "sd",
            label: "SD card (local downloads)", writable: true },
        ...usb.map((v) => ({ ...v, ejecting: this.blocked.has(v.instance) }))];
    }

    async resolve(rootPath, expectedId = null) {
        const root = path.resolve(rootPath);
        const volume = (await this.volumes()).find((v) => v.rootPath === root &&
            (!expectedId || v.id === expectedId) && v.writable && !v.ejecting);
        if (!volume) throw new Error("Selected USB is missing, read-only, or being ejected");
        return volume;
    }

    async open(volume, settings) {
        const current = await this.resolve(volume.rootPath, volume.id);
        if (current.instance !== volume.instance) throw new Error("USB changed; retry the download");
        if (volume.kind === "sd") await fs.mkdir(volume.rootPath, { recursive: true });
        const handle = this.pin ? await fs.open(volume.rootPath, "r") : null;
        try {
            // Pin before rechecking. Normal unmount is now busy; after a lazy
            // unmount /proc/self/fd still addresses the old volume, never SD.
            const verified = await this.resolve(volume.rootPath, volume.id);
            if (verified.instance !== volume.instance) throw new Error("USB changed while opening it");
            if (handle && volume.mountId && await handleMountId(handle) !== volume.mountId) {
                throw new Error("USB mount changed while opening it");
            }
            const pinnedStat = handle ? await handle.stat() : await fs.stat(volume.rootPath);
            const pathStat = await fs.stat(volume.rootPath);
            if (pinnedStat.dev !== pathStat.dev || pinnedStat.ino !== pathStat.ino) {
                throw new Error("Storage changed while opening it");
            }
            const library = new UsbLibrary(this.pin ? `/proc/self/fd/${handle.fd}` : volume.rootPath, settings);
            const check = async (remainingBytes = null) => {
                const live = await this.resolve(volume.rootPath, volume.id);
                if (live.instance !== volume.instance) throw new Error("USB removed or changed");
                if (remainingBytes !== null) {
                    const info = await this.statfs(library.rootPath);
                    if (info.bavail * info.bsize < 256 * 1024 * 1024 + remainingBytes) {
                        throw new Error("Destination is nearly full (256 MiB reserve required)");
                    }
                }
            };
            await check();
            await library.verifyWritable();
            return { volume, library, check, close: async () => { await handle?.close(); } };
        } catch (error) {
            await handle?.close();
            throw error;
        }
    }
}
