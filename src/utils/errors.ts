export class AgentError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`Agent ${agentName} failed with exit code ${exitCode}`);
    this.name = "AgentError";
  }
}

export class AgentTimeoutError extends AgentError {
  constructor(agentName: string, timeoutMs: number) {
    super(agentName, -1, `Timed out after ${timeoutMs}ms`);
    this.name = "AgentTimeoutError";
  }
}

export class ResponseParseError extends Error {
  constructor(
    public readonly rawOutput: string,
    message: string,
  ) {
    super(message);
    this.name = "ResponseParseError";
  }
}

export class GitCloneError extends Error {
  constructor(
    public readonly repoUrl: string,
    public readonly reason: string,
  ) {
    super(`Failed to clone repository ${repoUrl}: ${reason}`);
    this.name = "GitCloneError";
  }
}

export class GitWorktreeError extends Error {
  constructor(
    public readonly ref: string,
    public readonly reason: string,
  ) {
    super(`Failed to create worktree for ref ${ref}: ${reason}`);
    this.name = "GitWorktreeError";
  }
}
