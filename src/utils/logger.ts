export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  return envLevel ? (LOG_LEVEL_MAP[envLevel] ?? LogLevel.INFO) : LogLevel.INFO;
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

/** JSON 모드 여부. LOG_FORMAT=json이면 구조화된 JSON 로그를 출력한다. */
function isJsonMode(): boolean {
  return process.env.LOG_FORMAT?.toLowerCase() === "json";
}

interface LogEntry {
  timestamp: string;
  level: string;
  context: string;
  message: string;
  error?: string;
  [key: string]: unknown;
}

function formatPlain(level: LogLevel, context: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${LEVEL_LABELS[level]}] [${context}] ${message}`;
}

function formatJson(level: LogLevel, context: string, message: string, extra?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: LEVEL_LABELS[level],
    context,
    message,
    ...extra,
  };
  return JSON.stringify(entry);
}

function format(level: LogLevel, context: string, message: string, extra?: Record<string, unknown>): string {
  if (isJsonMode()) {
    return formatJson(level, context, message, extra);
  }
  return formatPlain(level, context, message);
}

function createLogger(context: string) {
  return {
    debug(message: string, extra?: Record<string, unknown>) {
      if (getLogLevel() <= LogLevel.DEBUG) {
        console.debug(format(LogLevel.DEBUG, context, message, extra));
      }
    },
    info(message: string, extra?: Record<string, unknown>) {
      if (getLogLevel() <= LogLevel.INFO) {
        console.info(format(LogLevel.INFO, context, message, extra));
      }
    },
    warn(message: string, extra?: Record<string, unknown>) {
      if (getLogLevel() <= LogLevel.WARN) {
        console.warn(format(LogLevel.WARN, context, message, extra));
      }
    },
    error(message: string, error?: unknown, extra?: Record<string, unknown>) {
      if (getLogLevel() <= LogLevel.ERROR) {
        const errStr = error instanceof Error ? error.message : error ? String(error) : undefined;
        const merged = { ...extra, ...(errStr ? { error: errStr } : {}) };
        if (isJsonMode()) {
          console.error(formatJson(LogLevel.ERROR, context, message, merged));
        } else {
          const suffix = errStr ? `: ${errStr}` : "";
          console.error(formatPlain(LogLevel.ERROR, context, message + suffix));
        }
      }
    },
  };
}

export const logger = {
  create: createLogger,
};
