import path from "node:path";

import { readJson, writeJsonAtomic } from "./atomic-json.mjs";
import { createDefaultState } from "./default-state.mjs";

export class StateStore {
    constructor(dataDir) {
        this.filePath = path.join(dataDir, "state.json");
        this.value = createDefaultState();
        this.updateChain = Promise.resolve();
    }

    async load() {
        const loaded = await readJson(this.filePath, createDefaultState());
        if (loaded?.version !== 1 || !Array.isArray(loaded.subscriptions) || !Array.isArray(loaded.releases)) {
            throw new Error(`Unsupported companion state at ${this.filePath}`);
        }
        loaded.catalog = Array.isArray(loaded.catalog) ? loaded.catalog : [];
        loaded.browse = loaded.browse && typeof loaded.browse === "object" ? loaded.browse : null;
        this.value = loaded;
        return this.value;
    }

    async update(mutator) {
        const operation = this.updateChain.then(async () => {
            const next = structuredClone(this.value);
            await mutator(next);
            await writeJsonAtomic(this.filePath, next);
            this.value = next;
            return this.value;
        });
        this.updateChain = operation.catch(() => undefined);
        return operation;
    }
}
