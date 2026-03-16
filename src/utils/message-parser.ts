export interface ParsedMessage {
  version: string | undefined;
  jiraTickets: string[];
  content: string;
}

const VERSION_PATTERN = /^((?:(?:vc|er)-)?v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)(?:\s+|$)/;
const JIRA_TICKET_PATTERN = /[A-Z][A-Z0-9]+-\d+/g;

export function parseMessage(text: string): ParsedMessage {
  let remaining = text;
  let version: string | undefined;

  const versionMatch = remaining.match(VERSION_PATTERN);
  if (versionMatch) {
    version = versionMatch[1];
    remaining = remaining.slice(versionMatch[0].length);
  }

  const jiraTickets = [...new Set(remaining.match(JIRA_TICKET_PATTERN) ?? [])];

  return {
    version,
    jiraTickets,
    content: remaining,
  };
}
