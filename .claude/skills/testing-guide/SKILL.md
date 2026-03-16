---
name: testing-guide
description: 테스트 코드를 작성하거나 테스트 관련 작업을 할 때 사용
user-invocable: false
---

# 테스트 가이드

## 프레임워크

- **Vitest** 사용 (globals 모드 활성화)
- 설정 파일: `vitest.config.ts`

## 파일 위치

```
src/**/__tests__/**/*.test.ts
```

예시:
- `src/utils/__tests__/retry.test.ts`
- `src/agent/__tests__/orchestrator.test.ts`

## 테스트 구조

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("모듈명", () => {
  beforeEach(() => {
    // 테스트 전 설정
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("기대 동작을 서술", async () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected);
  });
});
```

## 모킹 패턴

### 모듈 모킹

```typescript
vi.mock("../claude-cli.js", () => ({
  runAgent: vi.fn(),
}));
```

### mock config 호이스팅

`vi.mock()`은 호이스팅되므로, mock 설정에 사용할 변수는 `vi.hoisted()` 또는 모듈 스코프에 선언한다.

### vi.mocked() 타입 안전 모킹

```typescript
import { runAgent } from "../utils/claude-cli.js";
vi.mock("../utils/claude-cli.js");

const mockedRunAgent = vi.mocked(runAgent);
mockedRunAgent.mockResolvedValue("결과");
```

### 콘솔 모킹

```typescript
vi.spyOn(console, "info").mockImplementation(() => {});
```

## 비동기 에러 테스트

```typescript
await expect(asyncFn()).rejects.toThrow(CustomError);
await expect(asyncFn()).rejects.toThrow("에러 메시지 포함 텍스트");
```

## 실행 명령어

```bash
npm test              # 전체 테스트 실행 (vitest run)
npm run test:watch    # 워치 모드
```
