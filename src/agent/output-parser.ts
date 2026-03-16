import { logger } from "../utils/logger.js";

const log = logger.create("output-parser");

export interface AgentOutput {
  status: "success" | "partial" | "failed";
  summary: string;
  details: string;
  confidence: "high" | "medium" | "low";
  [key: string]: unknown;
}

export interface SlackResponse {
  slack_message: string;
}

/**
 * 에이전트 출력에서 JSON을 파싱하고 기본 구조를 검증한다.
 * SDK structured output 덕분에 순수 JSON 문자열이 입력되지만,
 * 파싱 실패 시 raw output을 details에 감싸서 반환한다.
 */
export function parseAgentOutput(agentName: string, raw: string): AgentOutput {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (typeof parsed.status !== "string" || typeof parsed.summary !== "string") {
      log.warn(`[${agentName}] Output JSON missing required fields (status, summary)`);
      return {
        status: "partial",
        summary: `${agentName} 출력에 필수 필드 누락`,
        details: typeof parsed.details === "string" ? parsed.details : raw,
        confidence: "low",
        ...parsed,
      };
    }

    return parsed as AgentOutput;
  } catch {
    log.warn(`[${agentName}] Failed to parse JSON output, using raw text`);
    return {
      status: "partial",
      summary: `${agentName} 출력을 JSON으로 파싱할 수 없음`,
      details: raw,
      confidence: "low",
    };
  }
}

/**
 * 마크다운 코드블록(```json ... ```)으로 감싸진 텍스트에서 내용만 추출한다.
 * 코드블록이 없으면 원본 텍스트를 trim하여 반환한다.
 */
function stripMarkdownCodeBlock(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1].trim() : text.trim();
}

/**
 * 문자열에서 slack_message 필드를 추출한다.
 * 이중 JSON 감싸기(string → string)도 처리한다.
 */
function tryExtractSlackMessage(text: string): string | null {
  try {
    let parsed: unknown = JSON.parse(text);

    // 이중 감싸기: JSON.parse 결과가 문자열이면 한번 더 파싱
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "slack_message" in parsed
    ) {
      const msg = (parsed as Record<string, unknown>).slack_message;
      if (typeof msg === "string" && msg) {
        return msg;
      }
    }
  } catch {
    // JSON parse failed
  }
  return null;
}

/**
 * 텍스트에서 첫 번째 JSON 객체({...})를 추출한다.
 * 앞뒤에 부가 텍스트가 붙어있는 경우를 처리한다.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * response-writer 출력에서 slack_message를 추출한다.
 * 1) raw 그대로 직접 파싱 (slack_message 안에 ```가 있을 수 있으므로 코드블록 제거보다 우선)
 * 2) 실패 시 마크다운 코드블록 제거 후 재시도
 * 3) 실패 시 텍스트에서 JSON 객체를 추출하여 재시도
 * 4) 그래도 실패하면 raw output을 그대로 반환
 */
export function extractSlackMessage(raw: string): string {
  // 1차: raw 직접 파싱 (가장 흔한 케이스)
  const directResult = tryExtractSlackMessage(raw.trim());
  if (directResult) return directResult;

  // 2차: 코드블록 제거 후 파싱
  const cleaned = stripMarkdownCodeBlock(raw);
  if (cleaned !== raw.trim()) {
    const cleanedResult = tryExtractSlackMessage(cleaned);
    if (cleanedResult) return cleanedResult;
  }

  // 3차: 텍스트 안에 묻힌 JSON 객체 추출
  const jsonStr = extractJsonObject(raw);
  if (jsonStr) {
    const extracted = tryExtractSlackMessage(jsonStr);
    if (extracted) return extracted;
  }

  log.warn("Failed to extract slack_message from response-writer output");
  return raw;
}
