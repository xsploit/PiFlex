import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export class JobQueue extends EventEmitter {
    constructor({ retain = 100 } = {}) {
        super();
        this.retain = retain;
        this.jobs = [];
        this.pending = [];
        this.running = false;
    }

    enqueue(kind, details, handler) {
        const job = {
            id: randomUUID(),
            kind,
            details,
            state: "queued",
            progress: 0,
            message: "Queued",
            result: null,
            error: null,
            createdAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null,
            abortController: new AbortController(),
            handler,
        };
        this.jobs.unshift(job);
        this.pruneHistory();
        this.pending.push(job);
        queueMicrotask(() => this.#drain());
        return publicJob(job);
    }

    list() {
        return this.jobs.map(publicJob);
    }

    pruneHistory() {
        let finished = 0;
        this.jobs = this.jobs.filter((job) => ["queued", "running"].includes(job.state) || ++finished <= this.retain);
    }

    hasActiveJobs() {
        return this.jobs.some((job) => ["queued", "running"].includes(job.state));
    }

    cancel(id) {
        const job = this.jobs.find((candidate) => candidate.id === id);
        if (!job || !["queued", "running"].includes(job.state)) {
            return false;
        }
        job.abortController.abort(new Error("Cancelled"));
        if (job.state === "queued") {
            job.state = "cancelled";
            job.message = "Cancelled";
            job.finishedAt = new Date().toISOString();
            this.pending = this.pending.filter((candidate) => candidate !== job);
        }
        this.emit("changed", publicJob(job));
        return true;
    }

    async #drain() {
        if (this.running) {
            return;
        }
        this.running = true;
        try {
            while (this.pending.length > 0) {
                const job = this.pending.shift();
                if (job.state === "cancelled") {
                    continue;
                }
                job.state = "running";
                job.startedAt = new Date().toISOString();
                job.message = "Running";
                this.emit("changed", publicJob(job));

                const update = (progress, message) => {
                    job.progress = Math.max(0, Math.min(1, Number(progress) || 0));
                    job.message = message || job.message;
                    this.emit("changed", publicJob(job));
                };

                try {
                    job.result = await job.handler({
                        id: job.id,
                        signal: job.abortController.signal,
                        update,
                    });
                    job.state = "completed";
                    job.progress = 1;
                    job.message = "Completed";
                } catch (error) {
                    job.state = job.abortController.signal.aborted ? "cancelled" : "failed";
                    job.message = job.state === "cancelled" ? "Cancelled" : "Failed";
                    job.error = error?.message || String(error);
                }
                job.finishedAt = new Date().toISOString();
                this.emit("changed", publicJob(job));
                this.pruneHistory();
            }
        } finally {
            this.running = false;
        }
    }
}

function publicJob(job) {
    const { abortController, handler, ...safe } = job;
    return structuredClone(safe);
}
