import type { App, SayFn } from "@slack/bolt";
import { analyzeTicket } from "../agent/orchestrator.js";
import { config } from "../config/index.js";
import { AgentError, AgentTimeoutError, GitWorktreeError } from "../utils/errors.js";
import { parseMessage } from "../utils/message-parser.js";
import { logger } from "../utils/logger.js";
import { Semaphore } from "../utils/semaphore.js";

const log = logger.create("handler");
const startTime = Date.now();

/** 처리 중인 메시지를 추적하여 중복 처리를 방지한다 */
const processingMessages = new Set<string>();

/** 동시 분석 요청 수를 제한한다 */
const semaphore = new Semaphore(config.maxConcurrentRequests);

function getErrorMessage(err: unknown): string {
  if (err instanceof AgentTimeoutError) {
    return `분석 시간이 초과되었습니다. (${err.agentName} 에이전트)`;
  }
  if (err instanceof GitWorktreeError) {
    return `요청하신 버전(${err.ref})을 찾을 수 없습니다.`;
  }
  if (err instanceof AgentError) {
    return `${err.agentName} 에이전트 실행 중 오류가 발생했습니다.`;
  }
  return "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

/** 공통 메시지 처리 로직 */
async function handleAnalysisRequest(
  app: App,
  text: string,
  channel: string,
  ts: string,
  say: SayFn,
): Promise<void> {
  const messageId = `${channel}-${ts}`;

  if (processingMessages.has(messageId)) return;
  processingMessages.add(messageId);

  try {
    // health check
    if (text === "ping" || text === "health") {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      await say({ text: `Oncall Bot is running. Uptime: ${uptimeSeconds}s`, thread_ts: ts });
      return;
    }

    if (!text) {
      await say({ text: "분석할 내용을 함께 보내주세요.", thread_ts: ts });
      return;
    }

    const { version, jiraTickets, content } = parseMessage(text);

    // 동시 요청 제한 확인
    if (semaphore.waitingCount > 0) {
      log.info(`Request queued (active: ${semaphore.activeCount}, waiting: ${semaphore.waitingCount})`);
    }

    await semaphore.acquire();
    try {
      await app.client.reactions.add({ channel, timestamp: ts, name: "eyes" });

      const result = await analyzeTicket(content, { version, jiraTickets });

      await say({ text: result.slackMessage, thread_ts: ts });
      await app.client.reactions.add({ channel, timestamp: ts, name: "white_check_mark" });
    } finally {
      semaphore.release();
    }
  } catch (err) {
    log.error("Analysis failed", err);
    await say({ text: getErrorMessage(err), thread_ts: ts });
  } finally {
    processingMessages.delete(messageId);
  }
}

export function registerHandlers(app: App): void {
  // 앱 멘션 이벤트 처리
  app.event("app_mention", async ({ event, say }) => {
    const rawText = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    await handleAnalysisRequest(app, rawText, event.channel, event.ts, say);
  });

  // DM 메시지 처리
  app.message(async ({ message, say }) => {
    if (!("text" in message) || message.subtype) return;
    if ("bot_id" in message && message.bot_id) return;

    const rawText = (message.text ?? "").trim();
    if (!rawText) return;

    await handleAnalysisRequest(app, rawText, message.channel, message.ts, say);
  });
}
