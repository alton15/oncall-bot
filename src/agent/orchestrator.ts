import { runAgent } from "../utils/agent-runner.js";
import { config } from "../config/index.js";
import { ensureBaseRepoCloned, createWorktree, cleanupWorktree, getDiffSummary } from "../utils/git-repo.js";
import { selectVersion } from "../utils/version-selector.js";
import { logger } from "../utils/logger.js";
import { extractSlackMessage } from "./output-parser.js";

const log = logger.create("orchestrator");

export interface AnalysisResult {
  slackMessage: string;
  rawDiagnosis: string;
  rawCodeAnalysis: string;
  rawContext?: string;
}

/**
 * context-gatherer를 실행하여 Jira/Confluence 맥락을 수집한다.
 * 실패 시 undefined를 반환하고 파이프라인을 계속 진행한다.
 */
async function runContextGatherer(
  ticketContent: string,
  jiraTickets: string[],
): Promise<string | undefined> {
  const contextGathererConfig = {
    agentName: "context-gatherer" as const,
    timeout: config.agentTimeouts.contextGatherer,
    allowedTools: [
      "mcp__atlassian-mcp-server__jira_get_issue",
      "mcp__atlassian-mcp-server__jira_search_issues",
      "mcp__atlassian-mcp-server__jira_get_my_issues",
      "mcp__atlassian-mcp-server__confluence_get_page",
      "mcp__atlassian-mcp-server__confluence_search_pages",
      "mcp__atlassian-mcp-server__confluence_get_page_images",
      "mcp__atlassian-mcp-server__confluence_get_recent_updates",
    ],
    mcpServers: {
      "atlassian-mcp-server": {
        command: "uv",
        args: ["run", "--directory", config.mcpServers.atlassianAgentDir, "python", "-m", "atlassian_mcp"],
      },
    },
  };

  try {
    if (jiraTickets.length > 0) {
      log.info(`Running context-gatherer for tickets: ${jiraTickets.join(", ")}...`);
      return await runAgent({
        ...contextGathererConfig,
        prompt: buildContextGathererPrompt(jiraTickets),
      });
    } else {
      log.info("Running context-gatherer in search mode...");
      return await runAgent({
        ...contextGathererConfig,
        prompt: buildContextSearchPrompt(ticketContent),
      });
    }
  } catch (err: unknown) {
    log.warn(`context-gatherer failed, continuing without context: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * 메인 오케스트레이터: 티켓/질문을 받아 서브에이전트 파이프라인을 실행한다.
 *
 * 1. context-gatherer (Jira/Confluence 맥락 수집)
 * 2. 버전 선택 (message > affectsVersion > fixVersion > default)
 * 3. 워크트리 생성 + diff 수집
 * 4. code-analyzer → issue-diagnoser → response-writer
 */
export async function analyzeTicket(
  ticketContent: string,
  options?: { version?: string; jiraTickets?: string[] },
): Promise<AnalysisResult> {
  const jiraTickets = options?.jiraTickets ?? [];

  // Step 1: context-gatherer 먼저 실행 (워크트리 없이)
  const contextResult = await runContextGatherer(ticketContent, jiraTickets);

  // Step 2: 버전 선택 & 워크트리 생성
  let serviceProjectPath: string;
  let worktreePath: string | undefined;
  let diffSummary: string | undefined;

  if (config.serviceProjectPath) {
    serviceProjectPath = config.serviceProjectPath;
  } else {
    const selection = selectVersion({
      messageVersion: options?.version,
      contextResult,
      defaultRef: config.git.defaultRef,
    });
    log.info(`Version selected: ${selection.ref} (source: ${selection.source})`);

    await ensureBaseRepoCloned();
    worktreePath = await createWorktree(selection.ref);
    serviceProjectPath = worktreePath;

    // Step 3: diff 보충 (primary와 다른 fixVersion이 있으면)
    if (selection.diffTarget) {
      log.info(`Collecting diff: ${selection.ref}..${selection.diffTarget}`);
      diffSummary = await getDiffSummary(selection.ref, selection.diffTarget);
    }
  }

  try {
    // Step 4: 코드 분석
    log.info("Running code-analyzer...");
    const codeAnalysis = await runAgent({
      agentName: "code-analyzer",
      prompt: buildCodeAnalyzerPrompt(ticketContent, contextResult, serviceProjectPath, diffSummary),
      cwd: serviceProjectPath,
      timeout: config.agentTimeouts.codeAnalyzer,
      maxTurns: 15,
      allowedTools: ["Read", "Glob", "Grep"],
    });

    // Step 5: 이슈 진단
    log.info("Running issue-diagnoser...");
    const diagnosis = await runAgent({
      agentName: "issue-diagnoser",
      prompt: buildDiagnoserPrompt(ticketContent, codeAnalysis, contextResult, diffSummary),
      timeout: config.agentTimeouts.issueDiagnoser,
      allowedTools: [],
    });

    // Step 6: 응답 작성
    log.info("Running response-writer...");
    const response = await runAgent({
      agentName: "response-writer",
      prompt: buildResponseWriterPrompt(ticketContent, diagnosis),
      timeout: config.agentTimeouts.responseWriter,
      allowedTools: [],
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          slack_message: { type: "string" },
        },
        required: ["slack_message"],
      },
    });

    // response-writer의 출력에서 slack_message 추출
    const slackMessage = extractSlackMessage(response);

    return {
      slackMessage,
      rawDiagnosis: diagnosis,
      rawCodeAnalysis: codeAnalysis,
      rawContext: contextResult,
    };
  } finally {
    if (worktreePath) {
      await cleanupWorktree(worktreePath);
    }
  }
}

function buildContextGathererPrompt(jiraTickets: string[]): string {
  return `다음 Jira 티켓의 맥락 정보를 수집해줘.

## 대상 티켓
${jiraTickets.map((t) => `- ${t}`).join("\n")}

## 지시사항
- 각 티켓의 상세 정보(제목, 설명, 댓글, 상태)를 조회하라.
- 이슈의 affectsVersions, fixVersions 필드를 반드시 포함하라.
- 관련 Confluence 문서가 있으면 함께 조회하라.
- CLAUDE.md의 "모드 1: 특정 티켓 조회" 절차를 따르라.
- 결과는 반드시 CLAUDE.md에 정의된 JSON 형식으로 반환하라.`;
}

function buildContextSearchPrompt(question: string): string {
  return `다음 질문과 관련된 Jira 이슈와 Confluence 문서를 검색하여 맥락 정보를 수집해줘.

## 질문
${question}

## 지시사항
- 질문에서 핵심 키워드를 추출하여 관련 이슈와 문서를 검색하라.
- CLAUDE.md의 "모드 2: 키워드 검색" 절차를 따르라.
- 검색 결과 중 관련도가 높은 상위 2-3건만 상세 조회하라.
- 각 이슈의 affectsVersions, fixVersions 필드를 반드시 포함하라.
- 관련 정보가 없으면 빈 결과를 반환하라 (에러가 아님).
- 결과는 반드시 CLAUDE.md에 정의된 JSON 형식으로 반환하라.`;
}

function buildCodeAnalyzerPrompt(ticket: string, context?: string, serviceProjectPath?: string, diffSummary?: string): string {
  const contextSection = context
    ? `\n## Jira/Confluence 맥락\n${context}\n`
    : "";

  const diffSection = diffSummary
    ? `\n## 버전 간 변경 사항 (affects → fix)\n${diffSummary}\n`
    : "";

  const pathInstruction = serviceProjectPath
    ? `\n- 분석 대상 프로젝트 경로: ${serviceProjectPath}\n- 반드시 위 경로에서 코드를 탐색하라.`
    : "";

  return `다음 티켓/질문과 관련된 코드를 찾아 분석해줘.

## 티켓 내용
${ticket}
${contextSection}${diffSection}
## 지시사항${pathInstruction}
- 프로젝트의 코드를 탐색하여 티켓 내용과 관련된 모든 코드를 찾아라.
- 에러 메시지, API 엔드포인트, 함수명, 모듈명 등 키워드를 기반으로 검색하라.${context ? "\n- Jira/Confluence 맥락에서 언급된 코드, 모듈, 에러도 함께 검색하라." : ""}${diffSummary ? "\n- 버전 간 변경 사항도 참고하여 분석하라." : ""}
- 결과는 반드시 CLAUDE.md에 정의된 JSON 형식으로 반환하라.`;
}

function buildDiagnoserPrompt(ticket: string, codeAnalysis: string, context?: string, diffSummary?: string): string {
  const contextSection = context
    ? `\n## Jira/Confluence 맥락\n${context}\n`
    : "";

  const diffSection = diffSummary
    ? `\n## 버전 간 변경 사항 (affects → fix)\n${diffSummary}\n`
    : "";

  return `다음 티켓의 문제를 진단해줘.

## 원본 티켓
${ticket}
${contextSection}
## 코드 분석 결과
${codeAnalysis}
${diffSection}
## 지시사항
- 코드 분석 결과를 기반으로 문제의 근본 원인을 파악하라.
- 영향 범위와 해결 방안을 구체적으로 제시하라.${diffSummary ? "\n- 버전 간 변경 사항이 문제와 관련이 있는지 확인하라." : ""}
- 결과는 반드시 CLAUDE.md에 정의된 JSON 형식으로 반환하라.`;
}

function buildResponseWriterPrompt(ticket: string, diagnosis: string): string {
  return `다음 진단 결과를 Slack 메시지로 작성해줘.

## 원본 티켓
${ticket}

## 진단 결과
${diagnosis}

## 지시사항
- Slack mrkdwn 형식으로 작성하라.
- 2000자 이내로 작성하라.
- 결과는 반드시 CLAUDE.md에 정의된 JSON 형식으로 반환하라.`;
}
