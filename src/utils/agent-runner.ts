import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config/index.js";
import { AgentError, AgentTimeoutError } from "./errors.js";
import { logger } from "./logger.js";
import { retry } from "./retry.js";

const log = logger.create("agent-runner");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

export interface RunAgentOptions {
  /** 서브에이전트 이름 (agents/ 하위 디렉토리명) */
  agentName: string;
  /** 에이전트에게 전달할 프롬프트 */
  prompt: string;
  /** 작업 디렉토리 (기본: 현재 프로젝트 루트) */
  cwd?: string;
  /** 타임아웃 (ms, 기본: 120000) */
  timeout?: number;
  /** 최대 에이전트 턴 수 (도구 호출 횟수 제한) */
  maxTurns?: number;
  /** 허용할 도구 목록 */
  allowedTools?: string[];
  /** MCP 서버 설정 */
  mcpServers?: Record<string, { command: string; args: string[] }>;
  /** 구조화된 출력을 위한 JSON Schema */
  outputSchema?: Record<string, unknown>;
}

/**
 * 에이전트 디렉토리의 CLAUDE.md를 읽어서 시스템 프롬프트를 구성한다.
 */
function loadAgentSystemPrompt(agentName: string): string {
  const commonClaudeMdPath = path.join(PROJECT_ROOT, "agents", "CLAUDE.md");
  const agentClaudeMdPath = path.join(PROJECT_ROOT, "agents", agentName, "CLAUDE.md");

  let systemPrompt = `You are the ${agentName} agent.\n\n`;

  if (fs.existsSync(commonClaudeMdPath)) {
    systemPrompt += fs.readFileSync(commonClaudeMdPath, "utf-8") + "\n\n";
  }

  if (fs.existsSync(agentClaudeMdPath)) {
    systemPrompt += fs.readFileSync(agentClaudeMdPath, "utf-8");
  }

  return systemPrompt;
}

/**
 * Claude Agent SDK를 사용하여 서브에이전트를 실행한다.
 */
export async function runAgent(options: RunAgentOptions): Promise<string> {
  const {
    agentName,
    prompt,
    cwd,
    timeout,
    maxTurns,
    allowedTools,
    mcpServers,
    outputSchema,
  } = options;

  const workingDir = cwd ?? PROJECT_ROOT;
  const systemPrompt = loadAgentSystemPrompt(agentName);

  const execute = async (): Promise<string> => {
    const abortController = new AbortController();
    const timer = timeout
      ? setTimeout(() => abortController.abort(), timeout)
      : undefined;

    try {
      for await (const msg of query({
        prompt,
        options: {
          systemPrompt,
          cwd: workingDir,
          maxTurns,
          allowedTools,
          mcpServers: mcpServers
            ? Object.fromEntries(
                Object.entries(mcpServers).map(([name, cfg]) => [
                  name,
                  { type: "stdio" as const, command: cfg.command, args: cfg.args },
                ]),
              )
            : undefined,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          abortController,
          outputFormat: outputSchema
            ? { type: "json_schema" as const, schema: outputSchema }
            : undefined,
        },
      })) {
        if (msg.type === "result") {
          if (msg.subtype === "success") {
            log.debug(`[${agentName}] completed, turns: ${msg.num_turns}, cost: $${msg.total_cost_usd}`);
            if (msg.structured_output) {
              return JSON.stringify(msg.structured_output);
            }
            return msg.result;
          }
          // error subtypes: error_max_turns, error_during_execution, error_max_budget_usd, etc.
          const errorMsg = ("errors" in msg && Array.isArray(msg.errors))
            ? msg.errors.join("; ")
            : `Agent ended with subtype: ${msg.subtype}`;
          log.error(`[${agentName}] result error:`, {
            subtype: msg.subtype,
            errors: "errors" in msg ? msg.errors : undefined,
            result: "result" in msg ? msg.result : undefined,
          });
          throw new AgentError(agentName, 1, errorMsg);
        }
      }
      throw new AgentError(agentName, 1, "No result received");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AgentTimeoutError(agentName, timeout ?? 120_000);
      }
      const errDetail = err instanceof Error
        ? { errMessage: err.message, errStack: err.stack, errName: err.name, ...err }
        : err;
      log.error(`[${agentName}] SDK error: ${JSON.stringify(errDetail)}`);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return retry<string>(execute, {
    maxAttempts: config.agentMaxRetries,
    delayMs: 1000,
    backoffMultiplier: 2,
    shouldRetry: (err: unknown) => {
      if (err instanceof AgentTimeoutError) return false;
      if (err instanceof AgentError) return err.exitCode === 1;
      return false;
    },
  });
}
