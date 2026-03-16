import { describe, it, expect } from "vitest";
import { parseMessage } from "../message-parser.js";

describe("parseMessage", () => {
  it("parses version and content from message with semver tag", () => {
    const result = parseMessage("v1.2.3 왜 에러가 나나요?");
    expect(result.version).toBe("v1.2.3");
    expect(result.content).toBe("왜 에러가 나나요?");
    expect(result.jiraTickets).toEqual([]);
  });

  it("parses pre-release version tags", () => {
    const result = parseMessage("v1.0.0-beta.1 이 버전에서 뭐가 바뀌었나요?");
    expect(result.version).toBe("v1.0.0-beta.1");
    expect(result.content).toBe("이 버전에서 뭐가 바뀌었나요?");
    expect(result.jiraTickets).toEqual([]);
  });

  it("returns undefined version when no version prefix", () => {
    const result = parseMessage("그냥 질문입니다");
    expect(result.version).toBeUndefined();
    expect(result.content).toBe("그냥 질문입니다");
    expect(result.jiraTickets).toEqual([]);
  });

  it("returns undefined version for invalid version format (missing minor/patch)", () => {
    const result = parseMessage("v123 질문");
    expect(result.version).toBeUndefined();
    expect(result.content).toBe("v123 질문");
    expect(result.jiraTickets).toEqual([]);
  });

  it("returns undefined version when version is not at the start", () => {
    const result = parseMessage("질문 v1.2.3 관련");
    expect(result.version).toBeUndefined();
    expect(result.content).toBe("질문 v1.2.3 관련");
    expect(result.jiraTickets).toEqual([]);
  });

  it("extracts version when it is the entire message (no trailing content)", () => {
    const result = parseMessage("v1.0.0");
    expect(result.version).toBe("v1.0.0");
    expect(result.content).toBe("");
    expect(result.jiraTickets).toEqual([]);
  });

  it("extracts vc-v version when it is the entire message", () => {
    const result = parseMessage("vc-v2.2.0");
    expect(result.version).toBe("vc-v2.2.0");
    expect(result.content).toBe("");
    expect(result.jiraTickets).toEqual([]);
  });

  it("extracts bare version when it is the entire message", () => {
    const result = parseMessage("2.2.0");
    expect(result.version).toBe("2.2.0");
    expect(result.content).toBe("");
    expect(result.jiraTickets).toEqual([]);
  });

  it("handles version followed by multi-word content", () => {
    const result = parseMessage("v2.0.0 배포 후 500 에러 발생");
    expect(result.version).toBe("v2.0.0");
    expect(result.content).toBe("배포 후 500 에러 발생");
    expect(result.jiraTickets).toEqual([]);
  });

  it("handles pre-release with alpha suffix", () => {
    const result = parseMessage("v3.1.0-alpha 테스트 질문");
    expect(result.version).toBe("v3.1.0-alpha");
    expect(result.content).toBe("테스트 질문");
    expect(result.jiraTickets).toEqual([]);
  });

  it("parses vc-v prefixed version (monorepo tag format)", () => {
    const result = parseMessage("vc-v2.2.0 에러 발생");
    expect(result.version).toBe("vc-v2.2.0");
    expect(result.content).toBe("에러 발생");
    expect(result.jiraTickets).toEqual([]);
  });

  it("parses vc-v prefixed version with pre-release suffix", () => {
    const result = parseMessage("vc-v2.2.0-rc1 배포 후 문제");
    expect(result.version).toBe("vc-v2.2.0-rc1");
    expect(result.content).toBe("배포 후 문제");
    expect(result.jiraTickets).toEqual([]);
  });

  it("parses bare version without v prefix", () => {
    const result = parseMessage("2.2.0 에러 발생");
    expect(result.version).toBe("2.2.0");
    expect(result.content).toBe("에러 발생");
    expect(result.jiraTickets).toEqual([]);
  });

  it("parses bare version with pre-release suffix", () => {
    const result = parseMessage("2.2.0-alpha14 이 버전 확인");
    expect(result.version).toBe("2.2.0-alpha14");
    expect(result.content).toBe("이 버전 확인");
    expect(result.jiraTickets).toEqual([]);
  });

  it("parses er-v prefixed version (monorepo er module tag format)", () => {
    const result = parseMessage("er-v1.0.0-alpha1 에러 발생");
    expect(result.version).toBe("er-v1.0.0-alpha1");
    expect(result.content).toBe("에러 발생");
    expect(result.jiraTickets).toEqual([]);
  });

  it("parses er-v prefixed version with rc suffix", () => {
    const result = parseMessage("er-v1.0.0-rc3 확인 부탁");
    expect(result.version).toBe("er-v1.0.0-rc3");
    expect(result.content).toBe("확인 부탁");
    expect(result.jiraTickets).toEqual([]);
  });

  it("extracts er-v version when it is the entire message", () => {
    const result = parseMessage("er-v1.0.0");
    expect(result.version).toBe("er-v1.0.0");
    expect(result.content).toBe("");
    expect(result.jiraTickets).toEqual([]);
  });

  it("extracts a single Jira ticket", () => {
    const result = parseMessage("PROJ-123 이슈 확인 부탁드립니다");
    expect(result.jiraTickets).toEqual(["PROJ-123"]);
    expect(result.content).toBe("PROJ-123 이슈 확인 부탁드립니다");
  });

  it("extracts multiple Jira tickets", () => {
    const result = parseMessage("PROJ-123 TEAM-456 관련 이슈입니다");
    expect(result.jiraTickets).toEqual(["PROJ-123", "TEAM-456"]);
  });

  it("deduplicates repeated Jira tickets", () => {
    const result = parseMessage("PROJ-123 관련해서 PROJ-123 확인");
    expect(result.jiraTickets).toEqual(["PROJ-123"]);
  });

  it("extracts Jira tickets with version prefix", () => {
    const result = parseMessage("v1.2.3 PROJ-789 에러 발생");
    expect(result.version).toBe("v1.2.3");
    expect(result.jiraTickets).toEqual(["PROJ-789"]);
    expect(result.content).toBe("PROJ-789 에러 발생");
  });

  it("returns empty jiraTickets for plain text without tickets", () => {
    const result = parseMessage("API 타임아웃 이슈가 발생합니다");
    expect(result.jiraTickets).toEqual([]);
  });
});
