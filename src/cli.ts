/**
 * Slack 없이 오케스트레이터를 직접 테스트하는 CLI.
 *
 * 사용법:
 *   npx tsx src/cli.ts "PROJ-123 왜 500 에러가 나나요?"
 *   npx tsx src/cli.ts "API 타임아웃 이슈"
 */
import { analyzeTicket } from "./agent/orchestrator.js";
import { parseMessage } from "./utils/message-parser.js";
import { logger } from "./utils/logger.js";

const log = logger.create("cli");

const input = process.argv[2];
if (!input) {
  console.error("Usage: npx tsx src/cli.ts \"질문 내용\"");
  process.exit(1);
}

const { version, jiraTickets, content } = parseMessage(input);

log.info(`Input: ${input}`);
log.info(`Parsed — version: ${version ?? "none"}, tickets: [${jiraTickets.join(", ")}], content: ${content}`);

try {
  const result = await analyzeTicket(content, { version, jiraTickets });

  console.log("\n========== 결과 ==========");
  console.log(result.slackMessage);
  console.log("\n========== 상세 ==========");
  if (result.rawContext) {
    console.log("[Context]", result.rawContext.slice(0, 500));
  }
  console.log("[Code Analysis]", result.rawCodeAnalysis.slice(0, 500));
  console.log("[Diagnosis]", result.rawDiagnosis.slice(0, 500));
} catch (err) {
  log.error("Analysis failed", err);
  process.exit(1);
}
