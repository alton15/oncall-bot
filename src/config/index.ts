import "dotenv/config";
import path from "node:path";
import os from "node:os";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  return parsed;
}

export const config = {
  slack: {
    botToken: requireEnv("SLACK_BOT_TOKEN"),
    appToken: requireEnv("SLACK_APP_TOKEN"),
    signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
  },
  serviceProjectPath: process.env.SERVICE_PROJECT_PATH,
  git: {
    repoUrl: process.env.GIT_REPO_URL ?? "",
    baseClonePath: process.env.GIT_BASE_CLONE_PATH ?? path.join(os.tmpdir(), "oncall-bot-repo"),
    worktreeBasePath: process.env.GIT_WORKTREE_BASE_PATH ?? path.join(os.tmpdir(), "oncall-bot-worktrees"),
    defaultRef: process.env.GIT_DEFAULT_REF ?? "develop",
  },
  agentTimeouts: {
    contextGatherer: optionalEnvInt("AGENT_TIMEOUT_CONTEXT_GATHERER_MS", 180_000),
    codeAnalyzer: optionalEnvInt("AGENT_TIMEOUT_CODE_ANALYZER_MS", 300_000),
    issueDiagnoser: optionalEnvInt("AGENT_TIMEOUT_ISSUE_DIAGNOSER_MS", 300_000),
    responseWriter: optionalEnvInt("AGENT_TIMEOUT_RESPONSE_WRITER_MS", 60_000),
  },
  agentMaxRetries: optionalEnvInt("AGENT_MAX_RETRIES", 2),
  maxConcurrentRequests: optionalEnvInt("MAX_CONCURRENT_REQUESTS", 3),
  mcpServers: {
    atlassianAgentDir: process.env.ATLASSIAN_AGENT_DIR ?? "",
  },
} as const;
