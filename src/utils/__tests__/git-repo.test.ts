import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile } from "node:child_process";

vi.mock("../../config/index.js", () => ({
  config: {
    git: {
      repoUrl: "https://github.com/test-org/test-repo",
      baseClonePath: "/tmp/test-oncall-bot-repo",
      worktreeBasePath: "/tmp/test-oncall-bot-worktrees",
      defaultRef: "develop",
    },
  },
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => ({
    toString: () => "abcd1234",
  })),
}));

import fs from "node:fs/promises";
import { ensureBaseRepoCloned, createWorktree, cleanupWorktree, getDiffSummary, resolveRef } from "../git-repo.js";
import { GitCloneError, GitWorktreeError } from "../errors.js";

const mockExecFile = vi.mocked(execFile);

function mockExecFileSuccess(stdout = "") {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      cb(null, stdout, "");
    }
    return {} as ReturnType<typeof execFile>;
  });
}

function mockExecFileFailure(error: Error) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      cb(error, "", "");
    }
    return {} as ReturnType<typeof execFile>;
  });
}

describe("git-repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureBaseRepoCloned", () => {
    it("skips clone and fetches when base repo already exists", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && args.includes("--is-bare-repository")) {
            cb(null, "true", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      await ensureBaseRepoCloned();

      const calls = mockExecFile.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // 첫 번째 호출: rev-parse 검증, 두 번째: fetch
      const fetchCall = calls.find((c) => {
        const a = c[1] as string[];
        return Array.isArray(a) && a[0] === "fetch";
      });
      expect(fetchCall).toBeDefined();
    });

    it("re-clones when path exists but is not a valid bare repo", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(["HEAD", "objects"] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      const callArgs: string[][] = [];
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        if (Array.isArray(args)) callArgs.push(args);
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          // rev-parse --is-bare-repository fails (not a valid repo)
          if (Array.isArray(args) && args[0] === "rev-parse" && args.includes("--is-bare-repository")) {
            cb(new Error("fatal: not a git repository"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      await ensureBaseRepoCloned();

      // 내용물 개별 삭제 확인 (Docker 볼륨 마운트 포인트는 삭제 불가하므로 내부만 정리)
      expect(vi.mocked(fs.readdir)).toHaveBeenCalledWith("/tmp/test-oncall-bot-repo");
      expect(vi.mocked(fs.rm)).toHaveBeenCalledWith(
        "/tmp/test-oncall-bot-repo/HEAD",
        { recursive: true, force: true },
      );
      expect(vi.mocked(fs.rm)).toHaveBeenCalledWith(
        "/tmp/test-oncall-bot-repo/objects",
        { recursive: true, force: true },
      );
      // init --bare 방식으로 재생성 확인
      const initCall = callArgs.find((a) => a.includes("init") && a.includes("--bare"));
      expect(initCall).toBeDefined();
    });

    it("initializes bare repo when base does not exist", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
      mockExecFileSuccess();

      await ensureBaseRepoCloned();

      const calls = mockExecFile.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // init --bare 방식으로 생성
      const initCall = calls.find((c) => {
        const a = c[1] as string[];
        return Array.isArray(a) && a[0] === "init" && a.includes("--bare");
      });
      expect(initCall).toBeDefined();
      // remote add origin 확인
      const remoteCall = calls.find((c) => {
        const a = c[1] as string[];
        return Array.isArray(a) && a[0] === "remote" && a.includes("add");
      });
      expect(remoteCall).toBeDefined();
    });

    it("throws GitCloneError when clone fails", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
      mockExecFileFailure(new Error("Authentication failed"));

      await expect(ensureBaseRepoCloned()).rejects.toThrow(GitCloneError);
    });
  });

  describe("resolveRef", () => {
    it("returns ref as-is when it exists", async () => {
      mockExecFileSuccess();

      const result = await resolveRef("v1.2.3");

      expect(result).toBe("v1.2.3");
    });

    it("tries v-prefixed tag when bare version not found", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && args.includes("1.2.3")) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await resolveRef("1.2.3");

      expect(result).toBe("v1.2.3");
    });

    it("tries vc-v prefixed tag when bare version and v-prefix not found", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && (args.includes("2.2.0") || args.includes("v2.2.0"))) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await resolveRef("2.2.0");

      expect(result).toBe("vc-v2.2.0");
    });

    it("tries vc-v prefixed tag when v-prefix input not found", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && args.includes("v2.2.0")) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await resolveRef("v2.2.0");

      expect(result).toBe("vc-v2.2.0");
    });

    it("strips vc-v prefix to find v-prefixed tag", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && args.includes("vc-v2.1.2")) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await resolveRef("vc-v2.1.2");

      expect(result).toBe("v2.1.2");
    });

    it("tries er-v prefixed tag when v-prefix input not found", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && (args.includes("v1.0.0") || args.includes("vc-v1.0.0"))) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await resolveRef("v1.0.0");

      expect(result).toBe("er-v1.0.0");
    });

    it("strips er-v prefix to find v-prefixed tag", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && args.includes("er-v1.0.0")) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await resolveRef("er-v1.0.0");

      expect(result).toBe("v1.0.0");
    });

    it("tries er-v prefixed tag when bare version and v-prefix not found", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && (args.includes("1.0.0") || args.includes("v1.0.0") || args.includes("vc-v1.0.0"))) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await resolveRef("1.0.0");

      expect(result).toBe("er-v1.0.0");
    });

    it("returns original ref when no candidate matches", async () => {
      mockExecFileFailure(new Error("fatal: Needed a single revision"));

      const result = await resolveRef("nonexistent");

      expect(result).toBe("nonexistent");
    });

    it("resolves branch names as-is", async () => {
      mockExecFileSuccess();

      const result = await resolveRef("develop");

      expect(result).toBe("develop");
    });
  });

  describe("createWorktree", () => {
    it("creates worktree at expected path pattern", async () => {
      const callArgs: string[][] = [];
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        if (Array.isArray(args)) callArgs.push(args);
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          cb(null, "", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await createWorktree("v1.2.3");

      expect(result).toMatch(/v1\.2\.3-\d+-abcd1234$/);
      const worktreeAddCall = callArgs.find((a) => a[0] === "worktree" && a[1] === "add");
      expect(worktreeAddCall).toBeDefined();
      expect(worktreeAddCall![4]).toBe("v1.2.3");
    });

    it("resolves ref with v prefix when original not found", async () => {
      const callArgs: string[][] = [];
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        if (Array.isArray(args)) callArgs.push(args);
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          // rev-parse "1.2.3" fails, "v1.2.3" succeeds, everything else succeeds
          if (Array.isArray(args) && args[0] === "rev-parse" && args.includes("1.2.3")) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await createWorktree("1.2.3");

      expect(result).toMatch(/v1\.2\.3-\d+-abcd1234$/);
      const worktreeAddCall = callArgs.find((a) => a[0] === "worktree" && a[1] === "add");
      expect(worktreeAddCall).toBeDefined();
      expect(worktreeAddCall![4]).toBe("v1.2.3");
    });

    it("resolves ref with vc-v prefix when v-prefix not found", async () => {
      const callArgs: string[][] = [];
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        if (Array.isArray(args)) callArgs.push(args);
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && args[0] === "rev-parse" && (args.includes("2.2.0") || args.includes("v2.2.0"))) {
            cb(new Error("fatal: Needed a single revision"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await createWorktree("2.2.0");

      expect(result).toMatch(/vc-v2\.2\.0-\d+-abcd1234$/);
      const worktreeAddCall = callArgs.find((a) => a[0] === "worktree" && a[1] === "add");
      expect(worktreeAddCall).toBeDefined();
      expect(worktreeAddCall![4]).toBe("vc-v2.2.0");
    });

    it("throws GitWorktreeError when ref does not exist", async () => {
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          if (Array.isArray(args) && args[0] === "worktree") {
            cb(new Error("fatal: invalid reference: v99.99.99"), "", "");
          } else {
            cb(null, "", "");
          }
        }
        return {} as ReturnType<typeof execFile>;
      });

      await expect(createWorktree("v99.99.99")).rejects.toThrow(GitWorktreeError);
    });
  });

  describe("cleanupWorktree", () => {
    it("removes worktree and prunes", async () => {
      const callArgs: string[][] = [];
      mockExecFile.mockImplementation((...fnArgs: unknown[]) => {
        const args = fnArgs[1] as string[];
        if (Array.isArray(args)) callArgs.push(args);
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") {
          cb(null, "", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      await cleanupWorktree("/tmp/test-worktree");

      const removeCall = callArgs.find((a) => a[0] === "worktree" && a[1] === "remove");
      expect(removeCall).toBeDefined();
      const pruneCall = callArgs.find((a) => a[0] === "worktree" && a[1] === "prune");
      expect(pruneCall).toBeDefined();
    });

    it("does not throw when remove fails", async () => {
      mockExecFileFailure(new Error("worktree not found"));

      await expect(cleanupWorktree("/tmp/nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("getDiffSummary", () => {
    it("returns diff stat between two refs", async () => {
      const diffOutput = " src/api.ts | 10 ++++------\n 1 file changed, 4 insertions(+), 6 deletions(-)";
      mockExecFileSuccess(diffOutput);

      const result = await getDiffSummary("v1.2.3", "v1.3.0");

      expect(result).toBe(diffOutput.trim());
      const diffCall = mockExecFile.mock.calls.find((call) => {
        const args = call[1] as string[];
        return Array.isArray(args) && args[0] === "diff";
      });
      expect(diffCall).toBeDefined();
      const args = diffCall![1] as string[];
      expect(args).toContain("--stat");
      expect(args).toContain("v1.2.3..v1.3.0");
    });

    it("returns empty string when git diff fails", async () => {
      mockExecFileFailure(new Error("fatal: bad revision"));

      const result = await getDiffSummary("v1.2.3", "v99.99.99");

      expect(result).toBe("");
    });

    it("truncates output exceeding max length", async () => {
      const longOutput = "x".repeat(6000);
      mockExecFileSuccess(longOutput);

      const result = await getDiffSummary("v1.0.0", "v2.0.0");

      expect(result.length).toBeLessThanOrEqual(5000 + "\n... (truncated)".length);
      expect(result).toContain("... (truncated)");
    });
  });
});
