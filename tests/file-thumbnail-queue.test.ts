import assert from "node:assert/strict";
import test from "node:test";
import { createThumbnailQueue } from "../src/modules/workspace/connections/sftp/thumbnailQueue.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("memory cache evicts older previews", async () => {
  let reads = 0;
  const queue = createThumbnailQueue(async () => { reads++; return "preview"; });
  for (let index = 0; index < 129; index++) {
    queue.request(String(index), String(index), () => {});
    await tick();
  }
  queue.request("128", "128", () => {});
  assert.equal(reads, 129);
  queue.request("0", "0", () => {});
  assert.equal(reads, 130);
  await tick();
});

test("bounds concurrency, deduplicates, cancels offscreen work and reuses cached previews", async () => {
  const calls: string[] = [];
  const finish: Array<(value: string | null) => void> = [];
  const queue = createThumbnailQueue((path) => {
    calls.push(path);
    return new Promise((resolve) => finish.push(resolve));
  });
  const received: Array<string | null> = [];
  queue.request("a", "a", (value) => received.push(value));
  queue.request("a", "a", (value) => received.push(value));
  queue.request("b", "b", () => {});
  const cancel = queue.request("c", "c", () => assert.fail("canceled result"));
  assert.deepEqual(calls, ["a", "b"]);
  cancel();
  finish[0]("preview"); finish[1](null);
  await tick();
  assert.deepEqual(received, ["preview", "preview"]);
  queue.request("a", "a", (value) => assert.equal(value, "preview"));
  queue.request("b", "b", (value) => assert.equal(value, null));
  assert.deepEqual(calls, ["a", "b"]);
  queue.clear();
  queue.request("a", "a", () => {});
  assert.deepEqual(calls, ["a", "b", "a"]);
  finish[2](null);
  await tick();
});

test("listing refresh cannot reuse an old in-flight result; failures free the queue", async () => {
  let calls = 0;
  let finish!: (value: string | null) => void;
  const queue = createThumbnailQueue(() => {
    calls++;
    return calls === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.reject(new Error("unreadable"));
  });
  const cancel = queue.request("a", "a", () => assert.fail("unmounted"));
  cancel();
  queue.clear();
  let result: string | null | undefined;
  queue.request("a", "a", (value) => { result = value; });
  finish("old");
  await tick();
  assert.equal(calls, 2);
  assert.equal(result, null);
  queue.request("a", "a", (value) => assert.equal(value, null));
  assert.equal(calls, 2);
});
