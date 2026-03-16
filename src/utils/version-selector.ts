import { logger } from "./logger.js";

const log = logger.create("version-selector");

export interface JiraVersionInfo {
  affectsVersions?: string[];
  fixVersions?: string[];
}

export interface VersionSelectionResult {
  ref: string;
  source: "message" | "jira_affects" | "jira_fix" | "default";
  diffTarget?: string;
  allVersions: JiraVersionInfo;
}

/**
 * context-gatherer JSON 출력에서 Jira 버전 정보를 추출한다.
 *
 * 모드 1 (특정 티켓): jira.affectsVersions / jira.fixVersions
 * 모드 2 (키워드 검색): search_results.jira_issues[0].affectsVersions / fixVersions
 */
export function extractJiraVersions(contextJson: string): JiraVersionInfo | undefined {
  try {
    const cleaned = extractJsonString(contextJson);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    // 모드 1: 특정 티켓 조회
    if (parsed.jira && typeof parsed.jira === "object") {
      const jira = parsed.jira as Record<string, unknown>;
      return {
        affectsVersions: toStringArray(jira.affectsVersions),
        fixVersions: toStringArray(jira.fixVersions),
      };
    }

    // 모드 2: 키워드 검색 — 첫 번째 이슈에서 추출
    if (parsed.search_results && typeof parsed.search_results === "object") {
      const searchResults = parsed.search_results as Record<string, unknown>;
      if (Array.isArray(searchResults.jira_issues) && searchResults.jira_issues.length > 0) {
        const firstIssue = searchResults.jira_issues[0] as Record<string, unknown>;
        return {
          affectsVersions: toStringArray(firstIssue.affectsVersions),
          fixVersions: toStringArray(firstIssue.fixVersions),
        };
      }
    }

    return undefined;
  } catch (err: unknown) {
    log.warn(`Failed to parse context JSON for version extraction: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * 버전 선택 우선순위에 따라 워크트리에 사용할 ref를 결정한다.
 *
 * 1. 메시지 버전 (사용자 명시)
 * 2. Jira affectsVersion (이슈 발생 버전)
 * 3. Jira fixVersion (수정 대상 버전)
 * 4. defaultRef (GIT_DEFAULT_REF, 기본값: develop)
 */
export function selectVersion(opts: {
  messageVersion?: string;
  contextResult?: string;
  defaultRef: string;
}): VersionSelectionResult {
  const { messageVersion, contextResult, defaultRef } = opts;

  // 1. 메시지 버전 우선
  if (messageVersion) {
    const versions = contextResult ? extractJiraVersions(contextResult) : undefined;
    return {
      ref: messageVersion,
      source: "message",
      allVersions: versions ?? {},
    };
  }

  // 2-3. Jira 버전에서 추출
  if (contextResult) {
    const versions = extractJiraVersions(contextResult);
    if (versions) {
      const affectsVersion = firstNonEmpty(versions.affectsVersions);
      const fixVersion = firstNonEmpty(versions.fixVersions);

      if (affectsVersion) {
        return {
          ref: affectsVersion,
          source: "jira_affects",
          diffTarget: fixVersion && fixVersion !== affectsVersion ? fixVersion : undefined,
          allVersions: versions,
        };
      }

      if (fixVersion) {
        return {
          ref: fixVersion,
          source: "jira_fix",
          allVersions: versions,
        };
      }
    }
  }

  // 4. 기본값
  return {
    ref: defaultRef,
    source: "default",
    allVersions: {},
  };
}

/**
 * 에이전트 출력에서 JSON 문자열을 추출한다.
 * 1. 마크다운 코드블록(```json ... ```) 안의 내용
 * 2. 텍스트 속 최외곽 { ... } 객체
 * 3. 원본 그대로 (JSON.parse에서 에러 처리)
 */
function extractJsonString(text: string): string {
  // 1. 마크다운 코드블록
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 2. 최외곽 JSON 객체
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  // 3. 원본
  return text.trim();
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === "string");
  return strings.length > 0 ? strings : undefined;
}

function firstNonEmpty(arr?: string[]): string | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[0];
}
