---
name: coding-conventions
description: 이 프로젝트의 TypeScript 코딩 컨벤션과 패턴을 참고할 때 사용
user-invocable: false
---

# 코딩 컨벤션

## TypeScript 설정

- **strict 모드** 활성화
- 타겟: ES2022
- 모듈: Node16 (ESM)
- import 시 `.js` 확장자 필수: `import { foo } from "./bar.js"`

## 에러 처리

### 커스텀 에러 클래스 (`src/utils/errors.ts`)

프로젝트 전용 에러 클래스를 사용한다. 각 에러는 `Error`를 상속하며 `this.name`을 설정한다.

- `AgentError` — 에이전트 실행 실패 (agentName, exitCode, stderr 포함)
- `AgentTimeoutError` — 에이전트 타임아웃 (AgentError 상속)
- `ResponseParseError` — 에이전트 응답 파싱 실패 (rawOutput 포함)
- `GitCloneError` — Git 클론 실패 (repoUrl, reason 포함)
- `GitWorktreeError` — Git worktree 실패 (ref, reason 포함)

### catch 블록

```typescript
try {
  // ...
} catch (err: unknown) {
  if (err instanceof AgentTimeoutError) {
    // 타임아웃 처리
  } else if (err instanceof AgentError) {
    // 일반 에이전트 에러 처리
  } else {
    throw err;
  }
}
```

### Graceful Degradation

실패해도 전체 파이프라인이 중단되지 않아야 하는 경우 (예: context-gatherer), try-catch로 감싸고 로그만 남긴 후 계속 진행한다.

## 비동기 패턴

- **async/await 전용** — `.then()` 체이닝 사용하지 않음
- **retry 유틸리티** (`src/utils/retry.ts`): 지수 백오프 재시도, `shouldRetry()` 조건 지원
- **Semaphore** (`src/utils/semaphore.ts`): `acquire()` / `release()`로 동시성 제어

## 로깅

```typescript
import { logger } from "./utils/logger.js";
const log = logger.create("orchestrator");

log.info("파이프라인 시작", { ticketId });
log.error("에이전트 실패", err, { agentName });
```

- `logger.create("모듈명")`으로 컨텍스트별 로거 생성
- 로그 레벨: DEBUG, INFO, WARN, ERROR
- `LOG_FORMAT=json` 환경변수로 JSON 모드 전환 가능

## 환경변수 관리

`src/config/index.ts`에서 일괄 관리한다.

```typescript
// 필수 — 없으면 즉시 에러
const slackToken = requireEnv("SLACK_BOT_TOKEN");

// 선택 — 없으면 기본값 사용
const timeout = optionalEnvInt("AGENT_TIMEOUT", 120000);
```

- 시크릿 변수는 서브프로세스에 전달하지 않도록 필터링 (`claude-cli.ts`)

## 모듈 구조

- 단일 책임 원칙: 각 파일이 하나의 역할만 담당
- named export 사용 (default export 지양)
- interface-driven: 타입 정의 후 구현
- `as const` 적극 활용
