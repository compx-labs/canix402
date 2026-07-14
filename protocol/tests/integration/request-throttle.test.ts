import assert from "node:assert/strict";
import test from "node:test";

import {
  createRequestGate,
  withAlgodRequestGate
} from "../../src/services/request-throttle.js";

test("request gate bounds concurrent Algod request execution", async () => {
  const gate = createRequestGate({ concurrency: 2, delayMs: 0 });
  let active = 0;
  let peakActive = 0;
  const releases: Array<() => void> = [];

  const request = () =>
    gate.run(
      () =>
        new Promise<number>((resolve) => {
          active += 1;
          peakActive = Math.max(peakActive, active);
          releases.push(() => {
            active -= 1;
            resolve(active);
          });
        })
    );

  const first = request();
  const second = request();
  const third = request();
  await waitFor(() => releases.length === 2);

  assert.equal(peakActive, 2);
  assert.equal(releases.length, 2);

  releases.shift()?.();
  await waitFor(() => releases.length === 2 && active === 2);
  assert.equal(peakActive, 2);

  while (releases.length > 0) {
    releases.shift()?.();
  }
  await Promise.all([first, second, third]);
});

test("Algod client wrapper routes each request through the shared gate", async () => {
  const gate = createRequestGate({ concurrency: 1, delayMs: 0 });
  let active = 0;
  let peakActive = 0;
  const releases: Array<() => void> = [];
  const algod = {
    getApplicationByID: () => ({
      do: () =>
        new Promise<void>((resolve) => {
          active += 1;
          peakActive = Math.max(peakActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        })
    })
  };
  const wrapped = withAlgodRequestGate(algod, gate) as typeof algod;

  const first = wrapped.getApplicationByID().do();
  const second = wrapped.getApplicationByID().do();
  await waitFor(() => releases.length === 1);

  assert.equal(peakActive, 1);
  releases.shift()?.();
  await waitFor(() => releases.length === 1 && active === 1);
  releases.shift()?.();
  await Promise.all([first, second]);
  assert.equal(peakActive, 1);
});

test("Algod client wrapper retries a rate-limited request through the gate", async () => {
  const originalRetries = process.env.ALGOD_429_MAX_RETRIES;
  const originalDelay = process.env.ALGOD_429_RETRY_BASE_MS;
  process.env.ALGOD_429_MAX_RETRIES = "1";
  process.env.ALGOD_429_RETRY_BASE_MS = "0";
  let attempts = 0;
  const algod = {
    getApplicationByID: () => ({
      do: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw { status: 429 };
        }
        return "ok";
      }
    })
  };

  try {
    const wrapped = withAlgodRequestGate(
      algod,
      createRequestGate({ concurrency: 1, delayMs: 0 })
    ) as typeof algod;
    assert.equal(await wrapped.getApplicationByID().do(), "ok");
    assert.equal(attempts, 2);
  } finally {
    if (originalRetries === undefined) {
      delete process.env.ALGOD_429_MAX_RETRIES;
    } else {
      process.env.ALGOD_429_MAX_RETRIES = originalRetries;
    }
    if (originalDelay === undefined) {
      delete process.env.ALGOD_429_RETRY_BASE_MS;
    } else {
      process.env.ALGOD_429_RETRY_BASE_MS = originalDelay;
    }
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  while (!predicate()) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
