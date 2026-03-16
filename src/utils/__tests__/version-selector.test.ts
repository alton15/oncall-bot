import { describe, it, expect } from "vitest";
import { extractJiraVersions, selectVersion } from "../version-selector.js";

describe("extractJiraVersions", () => {
  it("extracts versions from mode 1 (specific ticket) format", () => {
    const json = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        affectsVersions: ["v1.2.3"],
        fixVersions: ["v1.3.0"],
      },
    });

    const result = extractJiraVersions(json);

    expect(result).toEqual({
      affectsVersions: ["v1.2.3"],
      fixVersions: ["v1.3.0"],
    });
  });

  it("extracts versions from mode 2 (keyword search) format", () => {
    const json = JSON.stringify({
      status: "success",
      search_results: {
        jira_issues: [
          {
            key: "PROJ-456",
            affectsVersions: ["v2.0.0"],
            fixVersions: ["v2.1.0"],
          },
          {
            key: "PROJ-789",
            affectsVersions: ["v3.0.0"],
          },
        ],
      },
    });

    const result = extractJiraVersions(json);

    expect(result).toEqual({
      affectsVersions: ["v2.0.0"],
      fixVersions: ["v2.1.0"],
    });
  });

  it("returns undefined when jira object has no version fields", () => {
    const json = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        title: "Some issue",
      },
    });

    const result = extractJiraVersions(json);

    expect(result).toEqual({
      affectsVersions: undefined,
      fixVersions: undefined,
    });
  });

  it("returns undefined when search_results has empty jira_issues", () => {
    const json = JSON.stringify({
      status: "success",
      search_results: {
        jira_issues: [],
        confluence_pages: [],
      },
    });

    const result = extractJiraVersions(json);

    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const result = extractJiraVersions("not valid json {{{");

    expect(result).toBeUndefined();
  });

  it("returns undefined when no jira or search_results present", () => {
    const json = JSON.stringify({
      status: "success",
      summary: "nothing found",
    });

    const result = extractJiraVersions(json);

    expect(result).toBeUndefined();
  });

  it("extracts JSON from markdown code block", () => {
    const text = `수집한 정보를 정리하면 다음과 같습니다.

\`\`\`json
{
  "status": "success",
  "jira": {
    "key": "PROJ-123",
    "affectsVersions": ["v1.2.3"],
    "fixVersions": ["v1.3.0"]
  }
}
\`\`\``;

    const result = extractJiraVersions(text);

    expect(result).toEqual({
      affectsVersions: ["v1.2.3"],
      fixVersions: ["v1.3.0"],
    });
  });

  it("extracts JSON object embedded in plain text", () => {
    const text = `수집한 정보를 정리하면 {"status": "success", "jira": {"key": "PROJ-123", "affectsVersions": ["v2.0.0"]}} 입니다.`;

    const result = extractJiraVersions(text);

    expect(result).toEqual({
      affectsVersions: ["v2.0.0"],
      fixVersions: undefined,
    });
  });

  it("handles text with no JSON at all", () => {
    const text = "수집한 정보를 정리하면 관련 이슈를 찾지 못했습니다.";

    const result = extractJiraVersions(text);

    expect(result).toBeUndefined();
  });

  it("handles empty version arrays", () => {
    const json = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        affectsVersions: [],
        fixVersions: [],
      },
    });

    const result = extractJiraVersions(json);

    expect(result).toEqual({
      affectsVersions: undefined,
      fixVersions: undefined,
    });
  });
});

describe("selectVersion", () => {
  const defaultRef = "develop";

  it("prioritizes message version over Jira versions", () => {
    const contextResult = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        affectsVersions: ["v1.2.3"],
        fixVersions: ["v1.3.0"],
      },
    });

    const result = selectVersion({
      messageVersion: "v9.9.9",
      contextResult,
      defaultRef,
    });

    expect(result.ref).toBe("v9.9.9");
    expect(result.source).toBe("message");
    expect(result.diffTarget).toBeUndefined();
  });

  it("selects affectsVersion when no message version", () => {
    const contextResult = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        affectsVersions: ["v1.2.3"],
        fixVersions: ["v1.3.0"],
      },
    });

    const result = selectVersion({ contextResult, defaultRef });

    expect(result.ref).toBe("v1.2.3");
    expect(result.source).toBe("jira_affects");
    expect(result.diffTarget).toBe("v1.3.0");
  });

  it("sets no diffTarget when affectsVersion equals fixVersion", () => {
    const contextResult = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        affectsVersions: ["v1.2.3"],
        fixVersions: ["v1.2.3"],
      },
    });

    const result = selectVersion({ contextResult, defaultRef });

    expect(result.ref).toBe("v1.2.3");
    expect(result.source).toBe("jira_affects");
    expect(result.diffTarget).toBeUndefined();
  });

  it("sets no diffTarget when only affectsVersion exists", () => {
    const contextResult = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        affectsVersions: ["v1.2.3"],
      },
    });

    const result = selectVersion({ contextResult, defaultRef });

    expect(result.ref).toBe("v1.2.3");
    expect(result.source).toBe("jira_affects");
    expect(result.diffTarget).toBeUndefined();
  });

  it("selects fixVersion when only fixVersion exists", () => {
    const contextResult = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        fixVersions: ["v1.3.0"],
      },
    });

    const result = selectVersion({ contextResult, defaultRef });

    expect(result.ref).toBe("v1.3.0");
    expect(result.source).toBe("jira_fix");
    expect(result.diffTarget).toBeUndefined();
  });

  it("falls back to defaultRef when no versions available", () => {
    const result = selectVersion({ defaultRef });

    expect(result.ref).toBe("develop");
    expect(result.source).toBe("default");
    expect(result.allVersions).toEqual({});
  });

  it("falls back to defaultRef when context-gatherer returned no versions", () => {
    const contextResult = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        title: "Some issue",
      },
    });

    const result = selectVersion({ contextResult, defaultRef });

    expect(result.ref).toBe("develop");
    expect(result.source).toBe("default");
  });

  it("falls back to defaultRef when context JSON is invalid", () => {
    const result = selectVersion({
      contextResult: "invalid json",
      defaultRef,
    });

    expect(result.ref).toBe("develop");
    expect(result.source).toBe("default");
  });

  it("extracts versions from mode 2 search_results format", () => {
    const contextResult = JSON.stringify({
      status: "success",
      search_results: {
        jira_issues: [
          {
            key: "PROJ-456",
            affectsVersions: ["v2.0.0"],
            fixVersions: ["v2.1.0"],
          },
        ],
      },
    });

    const result = selectVersion({ contextResult, defaultRef });

    expect(result.ref).toBe("v2.0.0");
    expect(result.source).toBe("jira_affects");
    expect(result.diffTarget).toBe("v2.1.0");
  });

  it("preserves allVersions in result", () => {
    const contextResult = JSON.stringify({
      status: "success",
      jira: {
        key: "PROJ-123",
        affectsVersions: ["v1.2.3", "v1.2.4"],
        fixVersions: ["v1.3.0"],
      },
    });

    const result = selectVersion({ contextResult, defaultRef });

    expect(result.allVersions).toEqual({
      affectsVersions: ["v1.2.3", "v1.2.4"],
      fixVersions: ["v1.3.0"],
    });
  });
});
