import { describe, it, expect, vi } from "vitest";
import { retry } from "../retry.js";

describe("retry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retry(fn, { maxAttempts: 3, delayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds eventually", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok");

    const result = await retry(fn, { maxAttempts: 3, delayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));

    await expect(
      retry(fn, { maxAttempts: 2, delayMs: 10 }),
    ).rejects.toThrow("always fail");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops retrying when shouldRetry returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("no retry"));

    await expect(
      retry(fn, {
        maxAttempts: 3,
        delayMs: 10,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("no retry");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const start = Date.now();
    await retry(fn, { maxAttempts: 2, delayMs: 50, backoffMultiplier: 2 });
    const elapsed = Date.now() - start;

    // First retry delay = 50ms * 2^0 = 50ms
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
