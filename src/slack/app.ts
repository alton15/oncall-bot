import { App, LogLevel } from "@slack/bolt";
import { config } from "../config/index.js";

export const slackApp = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  signingSecret: config.slack.signingSecret,
  socketMode: true,
  logLevel: LogLevel.INFO,
});
