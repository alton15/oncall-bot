# Oncall Bot - Main Agent

이 프로젝트는 Slack 온콜 봇으로, 들어오는 티켓/질문을 서비스 프로젝트 코드베이스 기반으로 분석하여 답변하는 시스템이다.

## 아키텍처

```
Slack 메시지 → 오케스트레이터 → 서브에이전트(claude CLI) → Slack 응답
```

- **런타임**: TypeScript + Node.js + Bolt.js (Slack SDK)
- **에이전트**: Claude Code CLI를 서브프로세스로 실행
- **서브에이전트**: `agents/` 디렉토리 하위에 각각의 CLAUDE.md로 정의

## 디렉토리 구조

```
src/
  index.ts              # 엔트리포인트
  cli.ts                # CLI 테스트 (Slack 없이 직접 실행)
  slack/                # Slack 봇 연동
  agent/                # 에이전트 오케스트레이션
    __tests__/           # 에이전트 테스트
  config/               # 설정
  utils/                # 유틸리티 (claude CLI 래퍼 등)
    __tests__/           # 유틸리티 테스트
agents/                 # 서브에이전트 CLAUDE.md 정의
  context-gatherer/     # Jira/Confluence 맥락 수집 에이전트
  code-analyzer/        # 코드 분석 에이전트
  issue-diagnoser/      # 이슈 진단 에이전트
  response-writer/      # 응답 작성 에이전트
.claude/
  skills/               # Claude Code 스킬 정의
  rules/                # Claude Code 파일 패턴별 규칙
```

## 서브에이전트 역할

| 에이전트 | 역할 | 실행 시점 |
|---------|------|----------|
| context-gatherer | Jira/Confluence에서 티켓 맥락 정보 수집 | 가장 먼저 실행 (실패 시 스킵) |
| code-analyzer | 서비스 프로젝트 코드를 탐색하고 관련 코드를 찾아 분석 | context-gatherer 완료 후 |
| issue-diagnoser | 코드 분석 결과를 바탕으로 문제 원인을 진단 | code-analyzer 완료 후 |
| response-writer | 진단 결과를 Slack 메시지 형식으로 정리 | issue-diagnoser 완료 후 |

## 에이전트 실행 흐름

1. Slack에서 메시지/멘션 수신
2. 오케스트레이터가 메시지 내용을 파싱 (버전 태그, Jira 티켓 번호 추출)
3. **context-gatherer** 에이전트가 Jira/Confluence에서 맥락 수집 (실패 시 스킵)
4. **버전 선택**: context-gatherer 결과에서 버전 정보를 추출하고 워크트리를 생성
5. **git diff 수집**: affectsVersion과 fixVersion이 다를 경우 diff 요약을 수집
6. **code-analyzer** 에이전트를 올바른 버전의 워크트리에서 실행 → 관련 코드 수집
7. **issue-diagnoser** 에이전트에 원본 질문 + 맥락 + 코드 분석 결과 + diff 전달 → 원인 진단
8. **response-writer** 에이전트가 최종 Slack 응답 생성
9. Slack 스레드에 응답 전송

## 버전 선택 우선순위

워크트리 생성 시 체크아웃할 ref를 다음 우선순위로 결정한다:

1. **메시지 버전** — 사용자가 Slack 메시지에 명시한 버전 (`v1.2.3 에러 발생`)
2. **Jira affectsVersion** — 이슈가 발생한 버전 (첫 번째)
3. **Jira fixVersion** — 수정 대상 버전 (첫 번째)
4. **defaultRef** — `GIT_DEFAULT_REF` 환경변수 (기본값: `develop`)

affectsVersion과 fixVersion이 둘 다 있고 서로 다를 경우, affectsVersion으로 워크트리를 생성하고 fixVersion과의 git diff를 보충 수집하여 분석에 활용한다.

## 코드 컨벤션

- **TypeScript**: strict 모드, ES2022 타겟, Node16 모듈 시스템, ESM (`.js` 확장자 import)
- **에러 처리**: 커스텀 에러 클래스 (`src/utils/errors.ts`) 사용, catch 블록에서 `unknown` 타입 명시
- **비동기**: async/await 전용, `retry()` 유틸리티로 재시도, `Semaphore`로 동시성 제어
- **로깅**: `logger.create("모듈명")` 패턴으로 컨텍스트별 로거 생성
- **환경변수**: `requireEnv()` (필수) / `optionalEnvInt()` (선택) 패턴, `src/config/index.ts`에서 일괄 관리
- **테스트**: Vitest, `src/**/__tests__/**/*.test.ts` 패턴, `vi.mock()` / `vi.mocked()` 활용

## 주요 명령어

```bash
npm run dev          # 개발 서버 (tsx watch)
npm run build        # TypeScript 빌드
npm start            # 프로덕션 실행
npm test             # 테스트 실행 (vitest run)
npm run test:watch   # 테스트 워치 모드
npm run lint         # ESLint 실행
npx tsx src/cli.ts "질문 내용"   # Slack 없이 CLI로 직접 테스트
```

## 작업 보고

Claude Code로 작업을 완료한 후에는 아래 형식으로 결과를 정리하여 보고한다:

```markdown
## 작업 요약
{한 줄 요약}

## 변경 파일
- `path/to/file.ts` — 변경 내용 요약

## 변경 내용 상세
### {변경 항목 1}
- 변경 전: ...
- 변경 후: ...
- 이유: ...

## 테스트 결과
- `npm test` 실행 결과 (pass/fail 수)

## 주의사항
- {있다면 기재}
```
