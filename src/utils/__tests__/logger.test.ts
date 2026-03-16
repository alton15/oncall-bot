import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../logger.js";

describe("logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;
  });

  it("logs info messages by default", () => {
    const log = logger.create("test");
    log.info("hello");
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.info).mock.calls[0][0]).toContain("[INFO]");
    expect(vi.mocked(console.info).mock.calls[0][0]).toContain("[test]");
    expect(vi.mocked(console.info).mock.calls[0][0]).toContain("hello");
  });

  it("suppresses debug messages at default log level", () => {
    const log = logger.create("test");
    log.debug("debug msg");
    expect(console.debug).not.toHaveBeenCalled();
  });

  it("shows debug messages when LOG_LEVEL=debug", () => {
    process.env.LOG_LEVEL = "debug";
    const log = logger.create("test");
    log.debug("debug msg");
    expect(console.debug).toHaveBeenCalledTimes(1);
  });

  it("includes error details when provided", () => {
    const log = logger.create("test");
    log.error("failed", new Error("boom"));
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain("boom");
  });

  it("includes timestamp in output", () => {
    const log = logger.create("test");
    log.info("ts check");
    const output = vi.mocked(console.info).mock.calls[0][0] as string;
    // ISO timestamp pattern
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  describe("JSON mode (LOG_FORMAT=json)", () => {
    beforeEach(() => {
      process.env.LOG_FORMAT = "json";
    });

    it("outputs valid JSON", () => {
      const log = logger.create("test");
      log.info("json test");
      const output = vi.mocked(console.info).mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("INFO");
      expect(parsed.context).toBe("test");
      expect(parsed.message).toBe("json test");
      expect(parsed.timestamp).toBeDefined();
    });

    it("includes error field in JSON output", () => {
      const log = logger.create("test");
      log.error("failed", new Error("boom"));
      const output = vi.mocked(console.error).mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.error).toBe("boom");
    });

    it("includes extra fields in JSON output", () => {
      const log = logger.create("test");
      log.info("with extra", { agentName: "code-analyzer", duration: 1234 });
      const output = vi.mocked(console.info).mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.agentName).toBe("code-analyzer");
      expect(parsed.duration).toBe(1234);
    });
  });
});
