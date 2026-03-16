import { config } from "./config/index.js";
import { slackApp } from "./slack/app.js";
import { registerHandlers } from "./slack/handlers.js";
import { ensureBaseRepoCloned } from "./utils/git-repo.js";
import { logger } from "./utils/logger.js";

const log = logger.create("oncall-bot");

async function main() {
  if (!config.serviceProjectPath) {
    log.info("No SERVICE_PROJECT_PATH set, initializing git repo for worktree mode...");
    await ensureBaseRepoCloned();
  }

  registerHandlers(slackApp);

  await slackApp.start();
  log.info("Bot is running");

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    try {
      await slackApp.stop();
      log.info("Shutdown complete");
    } catch (err) {
      log.error("Error during shutdown", err);
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("Failed to start", err);
  process.exit(1);
});
