import assert from "node:assert/strict";
import test from "node:test";

import { JobQueue } from "../src/job-queue.mjs";

test("job queue serializes work", async () => {
    const queue = new JobQueue();
    const order = [];
    queue.enqueue("first", {}, async () => {
        order.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push("first-end");
    });
    queue.enqueue("second", {}, async () => {
        order.push("second");
    });
    await waitUntil(() => queue.list().every((job) => job.state === "completed"));
    assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("queued jobs can be cancelled", async () => {
    const queue = new JobQueue();
    queue.enqueue("blocker", {}, async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const cancelled = queue.enqueue("cancel-me", {}, async () => assert.fail("cancelled handler ran"));
    assert.equal(queue.cancel(cancelled.id), true);
    await waitUntil(() => !queue.hasActiveJobs());
    assert.equal(queue.list().find((job) => job.id === cancelled.id).state, "cancelled");
});

async function waitUntil(predicate) {
    const deadline = Date.now() + 2_000;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error("Timed out waiting for job queue");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
