import { describe, it, expect } from "vitest";
import { Semaphore } from "../semaphore.js";

describe("Semaphore", () => {
  it("allows concurrent acquisitions up to max", async () => {
    const sem = new Semaphore(2);

    await sem.acquire();
    await sem.acquire();

    expect(sem.activeCount).toBe(2);
    expect(sem.waitingCount).toBe(0);

    sem.release();
    sem.release();
  });

  it("queues acquisitions beyond max", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let secondAcquired = false;
    const secondPromise = sem.acquire().then(() => {
      secondAcquired = true;
    });

    // yield to event loop
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    expect(sem.waitingCount).toBe(1);

    sem.release();
    await secondPromise;
    expect(secondAcquired).toBe(true);
    expect(sem.activeCount).toBe(1);

    sem.release();
  });

  it("processes queue in FIFO order", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];

    const p1 = sem.acquire().then(() => { order.push(1); });
    const p2 = sem.acquire().then(() => { order.push(2); });

    sem.release(); // releases to p1
    await p1;
    sem.release(); // releases to p2
    await p2;

    expect(order).toEqual([1, 2]);
    sem.release();
  });

  it("throws on invalid max", () => {
    expect(() => new Semaphore(0)).toThrow("Semaphore max must be >= 1");
    expect(() => new Semaphore(-1)).toThrow("Semaphore max must be >= 1");
  });
});
