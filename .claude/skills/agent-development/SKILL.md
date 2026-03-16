---
name: agent-development
description: 서브에이전트를 추가하거나 에이전트 파이프라인을 수정할 때 사용
user-invocable: false
---

# 에이전트 개발 가이드

## 파이프라인 구조

```
context-gatherer → code-analyzer → issue-diagnoser → response-writer
```

- **context-gatherer**: Jira/Confluence 맥락 수집 (실패 시 스킵, try-catch)
- **code-analyzer**: 서비스 프로젝트 코드에서 관련 파일 탐색/분석 (cwd: 서비스 프로젝트)
- **issue-diagnoser**: 맥락 + 코드 분석 결과로 원인 진단
- **response-writer**: 진단 결과를 Slack mrkdwn 메시지로 변환

오케스트레이션은 `src/agent/orchestrator.ts`의 `analyzeTicket()` 함수에서 수행한다.

## 에이전트 실행 메커니즘

`src/utils/claude-cli.ts`의 `runAgent()` 함수가 Claude CLI를 서브프로세스로 실행한다.

```typescript
interface RunAgentOptions {
  agentName: string;    // agents/{name}/CLAUDE.md
  prompt: string;
  cwd?: string;
  timeout?: number;
  maxTurns?: number;
  flags?: string[];
}
```

### 시스템 프롬프트 구성

1. `agents/CLAUDE.md` (공통 가이드라인) — 항상 포함
2. `agents/{agentName}/CLAUDE.md` (에이전트별 가이드라인) — 항상 포함

두 파일을 읽어 `--append-system-prompt`로 전달한다.

## 새 에이전트 추가 절차

1. `agents/{agent-name}/CLAUDE.md` 파일 생성
   - 역할, 입력, 작업 절차, 출력 형식 정의
   - 공통 JSON 출력 형식 준수 (status, summary, details, confidence)
2. `src/agent/orchestrator.ts`에 새 에이전트 호출 단계 추가
   - `runAgent({ agentName: "{agent-name}", prompt: ... })` 호출
   - 이전 단계 결과를 prompt에 포함
3. 필요시 `src/config/index.ts`에 타임아웃/재시도 설정 추가
4. `src/agent/__tests__/orchestrator.test.ts`에 테스트 추가

## 출력 파싱

`src/agent/output-parser.ts`에서 에이전트 출력을 파싱한다.

- `parseAgentOutput(agentName, raw)` — 텍스트에서 JSON 추출, 필수 필드 검증
- `extractSlackMessage(raw)` — `slack_message` 필드 추출 (response-writer 전용)
- JSON을 찾지 못하면 "partial" 상태로 폴백

## 에러 복구 전략

- **context-gatherer 실패**: 스킵하고 다음 단계 진행 (graceful degradation)
- **code-analyzer / issue-diagnoser 실패**: `AgentError` 또는 `AgentTimeoutError` 발생, 오케스트레이터에서 처리
- **response-writer 실패**: 폴백 메시지로 Slack 응답
- **파싱 실패**: `ResponseParseError` 발생, "partial" 상태의 기본 출력 반환
