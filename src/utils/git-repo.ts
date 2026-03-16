import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import { GitCloneError, GitWorktreeError } from "./errors.js";
import { logger } from "./logger.js";

const log = logger.create("git-repo");

export function execGit(
  args: string[],
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function ensureBaseRepoCloned(): Promise<void> {
  const { repoUrl, baseClonePath } = config.git;

  const exists = await fs.access(baseClonePath).then(
    () => true,
    () => false,
  );

  if (exists) {
    // 디렉토리가 존재하더라도 유효한 git bare repo인지 검증한다
    const isValidRepo = await execGit(["rev-parse", "--is-bare-repository"], baseClonePath).then(
      (out) => out === "true",
      () => false,
    );

    if (isValidRepo) {
      log.info(`Base repo already exists at ${baseClonePath}, fetching updates...`);
      try {
        await execGit(["fetch", "--tags", "--prune"], baseClonePath);
      } catch (err: unknown) {
        log.warn(`Failed to fetch updates: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // 유효하지 않은 디렉토리 — 내용물만 비우고 재클론
    // Docker 볼륨 마운트 포인트는 삭제할 수 없으므로 내부만 정리한다
    log.warn(`Path ${baseClonePath} exists but is not a valid bare repo, cleaning and re-cloning...`);
    const entries = await fs.readdir(baseClonePath);
    await Promise.all(
      entries.map((entry) => fs.rm(path.join(baseClonePath, entry), { recursive: true, force: true })),
    );
  }

  log.info(`Cloning bare repo from ${repoUrl}...`);
  await fs.mkdir(path.dirname(baseClonePath), { recursive: true });

  try {
    // 디렉토리가 이미 존재할 수 있으므로 init --bare + remote add + fetch 방식 사용
    await execGit(["init", "--bare", baseClonePath]);
    await execGit(["remote", "add", "origin", repoUrl], baseClonePath);
    // bare clone과 동일하게 refs/heads/*로 직접 매핑 (origin/develop 대신 develop으로 접근 가능)
    await execGit(["config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"], baseClonePath);
    await execGit(["fetch", "origin", "--tags", "--prune"], baseClonePath);
  } catch (err: unknown) {
    throw new GitCloneError(
      repoUrl,
      err instanceof Error ? err.message : String(err),
    );
  }

  log.info("Base repo cloned successfully");
}

/**
 * 주어진 버전 문자열에서 가능한 git ref 후보를 생성한다.
 *
 * Supported tag formats:
 * - vc-v2.2.0, vc-v2.2.0-rc1 (vc-prefixed tags)
 * - er-v1.0.0, er-v1.0.0-alpha1 (er-prefixed tags)
 * - v2.1.2, v2.1.1-h1 (standard semver tags)
 *
 * 입력 "2.2.0"    → ["2.2.0", "v2.2.0", "vc-v2.2.0", "er-v2.2.0"]
 * 입력 "v2.2.0"   → ["v2.2.0", "vc-v2.2.0", "er-v2.2.0", "2.2.0"]
 * 입력 "vc-v2.2.0" → ["vc-v2.2.0", "v2.2.0", "er-v2.2.0", "2.2.0"]
 * 입력 "er-v1.0.0" → ["er-v1.0.0", "v1.0.0", "vc-v1.0.0", "1.0.0"]
 * 입력 "develop"   → ["develop"]
 */
function buildRefCandidates(ref: string): string[] {
  const candidates = [ref];

  if (ref.startsWith("vc-v") || ref.startsWith("er-v")) {
    // vc-v2.2.0 → v2.2.0, er-v2.2.0, 2.2.0
    // er-v1.0.0 → v1.0.0, vc-v1.0.0, 1.0.0
    const otherPrefix = ref.startsWith("vc-v") ? "er-v" : "vc-v";
    const withoutPrefix = ref.slice(3); // "v2.2.0"
    candidates.push(withoutPrefix);
    candidates.push(`${otherPrefix}${withoutPrefix.slice(1)}`);
    candidates.push(withoutPrefix.slice(1)); // "2.2.0"
  } else if (ref.startsWith("v")) {
    // v2.2.0 → vc-v2.2.0, er-v2.2.0, 2.2.0
    candidates.push(`vc-${ref}`);
    candidates.push(`er-${ref}`);
    candidates.push(ref.slice(1));
  } else if (/^\d+\.\d+\.\d+/.test(ref)) {
    // 2.2.0 → v2.2.0, vc-v2.2.0, er-v2.2.0
    candidates.push(`v${ref}`);
    candidates.push(`vc-v${ref}`);
    candidates.push(`er-v${ref}`);
  }

  return candidates;
}

/**
 * 주어진 버전 문자열을 실제 git ref로 해석한다.
 * 브랜치와 태그 모두 확인하며, v / vc-v 접두사 유무도 시도한다.
 */
export async function resolveRef(ref: string): Promise<string> {
  const { baseClonePath } = config.git;
  const candidates = buildRefCandidates(ref);

  for (const candidate of candidates) {
    try {
      await execGit(["rev-parse", "--verify", candidate], baseClonePath);
      if (candidate !== ref) {
        log.info(`Resolved ref "${ref}" → "${candidate}"`);
      }
      return candidate;
    } catch {
      // try next candidate
    }
  }

  log.warn(`Could not resolve ref "${ref}", using as-is`);
  return ref;
}

export async function createWorktree(ref: string): Promise<string> {
  const { baseClonePath, worktreeBasePath } = config.git;

  await fs.mkdir(worktreeBasePath, { recursive: true });

  try {
    await execGit(["fetch", "--tags", "--prune"], baseClonePath);
  } catch (err: unknown) {
    log.warn(`Failed to fetch before worktree creation: ${err instanceof Error ? err.message : String(err)}`);
  }

  const resolvedRef = await resolveRef(ref);
  const timestamp = Date.now();
  const suffix = randomBytes(4).toString("hex");
  const worktreePath = path.join(worktreeBasePath, `${resolvedRef}-${timestamp}-${suffix}`);

  try {
    await execGit(
      ["worktree", "add", "--detach", worktreePath, resolvedRef],
      baseClonePath,
    );
  } catch (err: unknown) {
    throw new GitWorktreeError(
      ref,
      err instanceof Error ? err.message : String(err),
    );
  }

  log.info(`Worktree created at ${worktreePath} for ref ${resolvedRef}`);
  return worktreePath;
}

const DIFF_MAX_LENGTH = 5000;

/**
 * 두 ref 사이의 diff 요약을 반환한다.
 * bare clone에서 실행하므로 워크트리가 불필요하다.
 * 보충 정보이므로 실패 시 빈 문자열을 반환한다.
 */
export async function getDiffSummary(fromRef: string, toRef: string): Promise<string> {
  const { baseClonePath } = config.git;

  try {
    const resolvedFrom = await resolveRef(fromRef);
    const resolvedTo = await resolveRef(toRef);
    const result = await execGit(["diff", "--stat", `${resolvedFrom}..${resolvedTo}`], baseClonePath);
    if (result.length > DIFF_MAX_LENGTH) {
      return result.slice(0, DIFF_MAX_LENGTH) + "\n... (truncated)";
    }
    return result;
  } catch (err: unknown) {
    log.warn(`Failed to get diff summary ${fromRef}..${toRef}: ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
}

export async function cleanupWorktree(worktreePath: string): Promise<void> {
  const { baseClonePath } = config.git;

  try {
    await execGit(["worktree", "remove", "--force", worktreePath], baseClonePath);
  } catch (err: unknown) {
    log.warn(`Failed to remove worktree ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`);
    // fallback: try to remove directory manually
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  try {
    await execGit(["worktree", "prune"], baseClonePath);
  } catch {
    // ignore prune errors
  }
}
