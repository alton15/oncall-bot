import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config before importing orchestrator
vi.mock("../../config/index.js", () => ({
  config: {
    serviceProjectPath: "/fake/project",
    git: {
      repoUrl: "https://github.com/test-org/test-repo",
      baseClonePath: "/tmp/test-repo",
      worktreeBasePath: "/tmp/test-worktrees",
      defaultRef: "develop",
    },
    agentTimeouts: {
      contextGatherer: 180_000,
      codeAnalyzer: 180_000,
      issueDiagnoser: 120_000,
      responseWriter: 60_000,
    },
    agentMaxRetries: 2,
    maxConcurrentRequests: 3,
    mcpServers: {
      atlassianAgentDir: "/fake/atlassian-mcp-server",
    },
  },
}));

// Mock agent-runner
vi.mock("../../utils/agent-runner.js", () => ({
  runAgent: vi.fn(),
}));

// Mock git-repo
vi.mock("../../utils/git-repo.js", () => ({
  ensureBaseRepoCloned: vi.fn().mockResolvedValue(undefined),
  createWorktree: vi.fn(),
  cleanupWorktree: vi.fn(),
  getDiffSummary: vi.fn(),
}));

// Mock version-selector
vi.mock("../../utils/version-selector.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/version-selector.js")>();
  return {
    ...actual,
    selectVersion: vi.fn(actual.selectVersion),
  };
});

import { analyzeTicket } from "../orchestrator.js";
import { runAgent } from "../../utils/agent-runner.js";
import { createWorktree, cleanupWorktree, getDiffSummary } from "../../utils/git-repo.js";
import { selectVersion } from "../../utils/version-selector.js";
import { config } from "../../config/index.js";

const mockRunAgent = vi.mocked(runAgent);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockCleanupWorktree = vi.mocked(cleanupWorktree);
const mockGetDiffSummary = vi.mocked(getDiffSummary);
const mockSelectVersion = vi.mocked(selectVersion);

describe("orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs four agents in sequence: context-gatherer → code-analyzer → issue-diagnoser → response-writer", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
      .mockResolvedValueOnce('{"files": []}') // code-analyzer
      .mockResolvedValueOnce('{"diagnosis": "no issue"}') // issue-diagnoser
      .mockResolvedValueOnce('{"slack_message": "All clear!"}'); // response-writer

    const result = await analyzeTicket("test ticket");

    expect(mockRunAgent).toHaveBeenCalledTimes(4);
    expect(mockRunAgent.mock.calls[0][0]).toMatchObject({ agentName: "context-gatherer" });
    expect(mockRunAgent.mock.calls[1][0]).toMatchObject({ agentName: "code-analyzer" });
    expect(mockRunAgent.mock.calls[2][0]).toMatchObject({ agentName: "issue-diagnoser" });
    expect(mockRunAgent.mock.calls[3][0]).toMatchObject({ agentName: "response-writer" });

    expect(result.slackMessage).toBe("All clear!");
    expect(result.rawCodeAnalysis).toBe('{"files": []}');
    expect(result.rawDiagnosis).toBe('{"diagnosis": "no issue"}');
  });

  it("continues pipeline when context-gatherer fails", async () => {
    mockRunAgent
      .mockRejectedValueOnce(new Error("context-gatherer timeout")) // context-gatherer fails
      .mockResolvedValueOnce('{"files": ["src/app.ts"]}') // code-analyzer
      .mockResolvedValueOnce('{"diagnosis": "found bug"}') // issue-diagnoser
      .mockResolvedValueOnce('{"slack_message": "Bug found!"}'); // response-writer

    const result = await analyzeTicket("test ticket");

    expect(mockRunAgent).toHaveBeenCalledTimes(4);
    expect(result.slackMessage).toBe("Bug found!");
    expect(result.rawContext).toBeUndefined();
  });

  it("returns raw output when slack_message JSON parsing fails", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
      .mockResolvedValueOnce("code analysis result")
      .mockResolvedValueOnce("diagnosis result")
      .mockResolvedValueOnce("plain text response");

    const result = await analyzeTicket("test");

    expect(result.slackMessage).toBe("plain text response");
  });

  it("propagates code-analyzer errors", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
      .mockRejectedValueOnce(new Error("code-analyzer failed")); // code-analyzer fails

    await expect(analyzeTicket("test")).rejects.toThrow("code-analyzer failed");
  });

  it("passes ticket content to code-analyzer prompt", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce('{"slack_message": "done"}');

    await analyzeTicket("my specific ticket content");

    const codeAnalyzerPrompt = mockRunAgent.mock.calls[1][0].prompt;
    expect(codeAnalyzerPrompt).toContain("my specific ticket content");
  });

  it("passes code analysis to issue-diagnoser", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
      .mockResolvedValueOnce("analysis from code-analyzer")
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce('{"slack_message": "done"}');

    await analyzeTicket("ticket");

    const diagnoserPrompt = mockRunAgent.mock.calls[2][0].prompt;
    expect(diagnoserPrompt).toContain("analysis from code-analyzer");
  });

  it("runs context-gatherer in search mode when no jira tickets", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer (search mode)
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce('{"slack_message": "done"}');

    await analyzeTicket("API 타임아웃 이슈");

    expect(mockRunAgent.mock.calls[0][0]).toMatchObject({ agentName: "context-gatherer" });
    const contextPrompt = mockRunAgent.mock.calls[0][0].prompt;
    expect(contextPrompt).toContain("API 타임아웃 이슈");
    expect(contextPrompt).toContain("키워드 검색");
  });

  it("runs context-gatherer in ticket mode when jira tickets provided", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer (ticket mode)
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce('{"slack_message": "done"}');

    await analyzeTicket("PROJ-123 이슈 확인", { jiraTickets: ["PROJ-123"] });

    expect(mockRunAgent.mock.calls[0][0]).toMatchObject({ agentName: "context-gatherer" });
    const contextPrompt = mockRunAgent.mock.calls[0][0].prompt;
    expect(contextPrompt).toContain("PROJ-123");
    expect(contextPrompt).toContain("특정 티켓 조회");
  });

  it("uses config-based timeouts for each agent", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}')
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce('{"slack_message": "done"}');

    await analyzeTicket("test");

    expect(mockRunAgent.mock.calls[0][0].timeout).toBe(180_000); // contextGatherer
    expect(mockRunAgent.mock.calls[1][0].timeout).toBe(180_000); // codeAnalyzer
    expect(mockRunAgent.mock.calls[2][0].timeout).toBe(120_000); // issueDiagnoser
    expect(mockRunAgent.mock.calls[3][0].timeout).toBe(60_000); // responseWriter
  });

  it("uses serviceProjectPath when configured (no worktree)", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce('{"slack_message": "done"}');

    await analyzeTicket("test", { version: "v1.0.0" });

    expect(mockCreateWorktree).not.toHaveBeenCalled();
    expect(mockCleanupWorktree).not.toHaveBeenCalled();
    expect(mockRunAgent.mock.calls[1][0].cwd).toBe("/fake/project");
  });

  it("skips version selection when serviceProjectPath is set", async () => {
    mockRunAgent
      .mockResolvedValueOnce('{"status": "success"}')
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce('{"slack_message": "done"}');

    await analyzeTicket("test");

    expect(mockSelectVersion).not.toHaveBeenCalled();
    expect(mockCreateWorktree).not.toHaveBeenCalled();
    expect(mockGetDiffSummary).not.toHaveBeenCalled();
  });

  describe("worktree mode (no serviceProjectPath)", () => {
    beforeEach(() => {
      (config as { serviceProjectPath: string | undefined }).serviceProjectPath = undefined;
      mockCreateWorktree.mockResolvedValue("/tmp/test-worktrees/v1.0.0-123-abc");
    });

    afterEach(() => {
      (config as { serviceProjectPath: string | undefined }).serviceProjectPath = "/fake/project";
    });

    it("creates worktree with specified version", async () => {
      mockRunAgent
        .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test", { version: "v1.0.0" });

      expect(mockSelectVersion).toHaveBeenCalledWith({
        messageVersion: "v1.0.0",
        contextResult: '{"status": "success"}',
        defaultRef: "develop",
      });
      expect(mockCreateWorktree).toHaveBeenCalledWith("v1.0.0");
      expect(mockRunAgent.mock.calls[1][0].cwd).toBe("/tmp/test-worktrees/v1.0.0-123-abc");
    });

    it("uses defaultRef when version not specified and no Jira versions", async () => {
      mockRunAgent
        .mockResolvedValueOnce('{"status": "success", "jira": {"key": "PROJ-1"}}') // context-gatherer (no versions)
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test");

      expect(mockCreateWorktree).toHaveBeenCalledWith("develop");
    });

    it("creates worktree with Jira affectsVersion", async () => {
      const contextWithVersions = JSON.stringify({
        status: "success",
        jira: {
          key: "PROJ-123",
          affectsVersions: ["v1.2.3"],
          fixVersions: ["v1.3.0"],
        },
      });

      mockRunAgent
        .mockResolvedValueOnce(contextWithVersions) // context-gatherer
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test");

      expect(mockCreateWorktree).toHaveBeenCalledWith("v1.2.3");
    });

    it("creates worktree with Jira fixVersion when no affectsVersion", async () => {
      const contextWithFixOnly = JSON.stringify({
        status: "success",
        jira: {
          key: "PROJ-123",
          fixVersions: ["v1.3.0"],
        },
      });

      mockRunAgent
        .mockResolvedValueOnce(contextWithFixOnly) // context-gatherer
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test");

      expect(mockCreateWorktree).toHaveBeenCalledWith("v1.3.0");
    });

    it("message version takes priority over Jira versions", async () => {
      const contextWithVersions = JSON.stringify({
        status: "success",
        jira: {
          key: "PROJ-123",
          affectsVersions: ["v1.2.3"],
          fixVersions: ["v1.3.0"],
        },
      });

      mockRunAgent
        .mockResolvedValueOnce(contextWithVersions) // context-gatherer
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test", { version: "v9.9.9" });

      expect(mockCreateWorktree).toHaveBeenCalledWith("v9.9.9");
    });

    it("falls back to defaultRef when context-gatherer fails", async () => {
      mockRunAgent
        .mockRejectedValueOnce(new Error("context-gatherer timeout")) // context-gatherer fails
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test");

      expect(mockCreateWorktree).toHaveBeenCalledWith("develop");
    });

    it("collects diff when diffTarget exists", async () => {
      const contextWithVersions = JSON.stringify({
        status: "success",
        jira: {
          key: "PROJ-123",
          affectsVersions: ["v1.2.3"],
          fixVersions: ["v1.3.0"],
        },
      });

      mockRunAgent
        .mockResolvedValueOnce(contextWithVersions)
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');
      mockGetDiffSummary.mockResolvedValue("file1.ts | 5 +++--");

      await analyzeTicket("test");

      expect(mockGetDiffSummary).toHaveBeenCalledWith("v1.2.3", "v1.3.0");
    });

    it("passes diff summary to code-analyzer and diagnoser prompts", async () => {
      const contextWithVersions = JSON.stringify({
        status: "success",
        jira: {
          key: "PROJ-123",
          affectsVersions: ["v1.2.3"],
          fixVersions: ["v1.3.0"],
        },
      });

      mockRunAgent
        .mockResolvedValueOnce(contextWithVersions)
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');
      mockGetDiffSummary.mockResolvedValue("src/api.ts | 10 ++++------");

      await analyzeTicket("test");

      const codeAnalyzerPrompt = mockRunAgent.mock.calls[1][0].prompt;
      expect(codeAnalyzerPrompt).toContain("src/api.ts | 10 ++++------");
      expect(codeAnalyzerPrompt).toContain("버전 간 변경 사항");

      const diagnoserPrompt = mockRunAgent.mock.calls[2][0].prompt;
      expect(diagnoserPrompt).toContain("src/api.ts | 10 ++++------");
      expect(diagnoserPrompt).toContain("버전 간 변경 사항");
    });

    it("does not call getDiffSummary when no diffTarget", async () => {
      const contextWithAffectsOnly = JSON.stringify({
        status: "success",
        jira: {
          key: "PROJ-123",
          affectsVersions: ["v1.2.3"],
        },
      });

      mockRunAgent
        .mockResolvedValueOnce(contextWithAffectsOnly)
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test");

      expect(mockGetDiffSummary).not.toHaveBeenCalled();
    });

    it("cleans up worktree after success", async () => {
      mockRunAgent
        .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce("{}")
        .mockResolvedValueOnce('{"slack_message": "done"}');

      await analyzeTicket("test", { version: "v1.0.0" });

      expect(mockCleanupWorktree).toHaveBeenCalledWith("/tmp/test-worktrees/v1.0.0-123-abc");
    });

    it("cleans up worktree even on error", async () => {
      mockRunAgent
        .mockResolvedValueOnce('{"status": "success"}') // context-gatherer
        .mockRejectedValueOnce(new Error("Agent failed")); // code-analyzer

      await expect(analyzeTicket("test", { version: "v1.0.0" })).rejects.toThrow("Agent failed");

      expect(mockCleanupWorktree).toHaveBeenCalledWith("/tmp/test-worktrees/v1.0.0-123-abc");
    });
  });
});
