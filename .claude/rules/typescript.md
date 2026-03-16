---
paths:
  - "src/**/*.ts"
---

# TypeScript 코드 규칙

- strict 모드를 위반하는 코드를 작성하지 않는다 (`any` 사용 금지, 타입 assertion 최소화).
- ESM import에 `.js` 확장자를 반드시 붙인다: `import { foo } from "./bar.js"`
- 상수 객체에 `as const`를 활용한다.
- catch 블록에서 에러 타입을 `unknown`으로 명시한다: `catch (err: unknown)`
- 프로젝트 커스텀 에러 클래스 (`src/utils/errors.ts`)를 활용하여 적절한 에러를 throw한다.
- named export를 사용한다 (default export 지양).
- 비동기 함수는 async/await만 사용한다 (`.then()` 체이닝 금지).
- 환경변수 접근은 `src/config/index.ts`의 `requireEnv()` / `optionalEnvInt()`를 통해서만 한다.
- 로거는 `logger.create("모듈명")` 패턴으로 생성한다.
