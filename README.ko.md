# Oncall Bot

English version: [README.md](./README.md)

Claude Code CLI를 서브에이전트 오케스트레이터로 사용하는 Slack 온콜 어시스턴트 봇입니다. Slack으로 들어오는 티켓/질문을 서비스 프로젝트 코드베이스 기반으로 분석하여 구조화된 진단 결과를 응답합니다.

4단계 Claude Code CLI 서브에이전트 파이프라인을 실행합니다: 컨텍스트 수집 (Jira/Confluence) -> 코드 분석 -> 이슈 진단 -> 응답 포맷팅.

## 아키텍처

```
Slack 메시지 (채널 멘션 or DM)
  |
메시지 파싱 (버전 태그 + Jira 티켓 번호 + 질문 내용 분리)
  |
오케스트레이터 (Git worktree 준비 -> 에이전트 파이프라인 실행)
  |
+-- 1. context-gatherer -- Jira/Confluence 컨텍스트 수집 (실패해도 계속 진행)
+-- 2. code-analyzer ----- 서비스 프로젝트 코드 탐색 및 분석
+-- 3. issue-diagnoser --- 코드 분석 + 컨텍스트 기반 원인 진단
+-- 4. response-writer --- Slack mrkdwn 형식으로 응답 생성
  |
Slack 스레드에 응답
```

### 에이전트 파이프라인

| 단계 | 에이전트 | 역할 | 기본 타임아웃 |
|------|---------|------|-------------|
| 1 | `context-gatherer` | Jira/Confluence에서 관련 컨텍스트 수집 (실패 시 스킵) | 180s |
| 2 | `code-analyzer` | 서비스 프로젝트 코드를 탐색하고 관련 코드를 찾아 분석 | 300s |
| 3 | `issue-diagnoser` | 코드 분석 결과를 바탕으로 문제 원인을 진단 | 300s |
| 4 | `response-writer` | 진단 결과를 Slack 메시지 형식으로 정리 | 60s |

각 에이전트는 `agents/` 디렉토리의 CLAUDE.md로 역할이 정의되며, Claude Code CLI 서브프로세스로 실행됩니다. 실패 시 지수 백오프로 재시도합니다 (타임아웃 제외).

### 코드 참조 모드

**로컬 경로 모드** -- `SERVICE_PROJECT_PATH` 환경변수가 설정된 경우, 해당 로컬 디렉토리를 직접 사용합니다.

**Git Worktree 모드** -- `SERVICE_PROJECT_PATH`가 미설정인 경우, 대상 레포를 bare clone 한 뒤 요청마다 git worktree를 생성하여 특정 버전의 코드를 참조합니다. 분석 완료 후 worktree는 자동 정리됩니다.

### 동시성 제어

Semaphore 기반으로 동시 처리 요청 수를 제한합니다 (기본: 3). 초과 요청은 대기열에 들어가 순서대로 처리됩니다. 같은 메시지의 중복 처리도 방지합니다.

## 주요 기능

- Bolt.js를 통한 Slack 연동 (Socket Mode) -- 채널 멘션 및 DM 지원
- Claude Code CLI (Claude Agent SDK)를 사용한 4단계 서브에이전트 파이프라인
- Atlassian MCP 서버를 통한 Jira/Confluence 컨텍스트 수집
- Git worktree 기반 버전별 코드 분석
- Jira affectsVersion/fixVersion 필드에서 자동 버전 선택
- 영향 버전과 수정 버전 간 Git diff 수집
- 구조화된 JSON 출력과 Slack mrkdwn 포맷팅
- 에이전트 타임아웃 및 재시도 정책 설정 가능
- Semaphore 기반 동시성 제어
- Slack 없이 분석을 실행할 수 있는 CLI 테스트 모드
- 프로덕션 배포를 위한 Docker 지원

## 기술 스택

- **런타임**: Node.js 20+ (ES Modules)
- **언어**: TypeScript (strict 모드)
- **Slack SDK**: @slack/bolt v4 (Socket Mode)
- **에이전트**: Claude Code CLI (@anthropic-ai/claude-agent-sdk)
- **테스트**: Vitest
- **빌드**: tsc

## 사전 요구사항

- **Node.js** 20 이상
- **Git** (worktree 모드 사용 시 필수)
- **Claude Code CLI** -- 시스템에 `claude` 명령어가 설치되어 있어야 합니다
- **Slack 앱** -- Socket Mode가 활성화된 Slack 앱
- **Atlassian MCP 서버** (선택) -- Jira/Confluence 컨텍스트 수집용

## 설정

### 1. 클론 및 설치

```bash
git clone https://github.com/alton15/oncall-bot.git
cd oncall-bot
npm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 값을 설정합니다. 전체 환경변수 표는 아래를 참고하세요.

### 3. Slack 앱 설정

1. [Slack API](https://api.slack.com/apps)에서 앱 생성
2. **Socket Mode** 활성화 후 App-Level Token (`xapp-...`) 발급
3. **Event Subscriptions** 활성화 후 `app_mention`, `message.im` 이벤트 구독
4. **OAuth & Permissions**에서 다음 Bot Token Scopes 추가:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
   - `reactions:write`
5. 워크스페이스에 앱 설치 후 Bot Token (`xoxb-...`) 확인

### 4. Atlassian 설정 (선택)

`context-gatherer` 에이전트는 Atlassian MCP 서버를 사용하여 Jira와 Confluence를 조회합니다. 해당 도구를 구현한 MCP 서버가 있다면 `ATLASSIAN_AGENT_DIR` 환경변수에 경로를 설정하세요:

```env
ATLASSIAN_AGENT_DIR=/path/to/your/atlassian-mcp-server
```

MCP 서버는 `atlassian_mcp` 패키지에 `__main__.py` 엔트리포인트가 있어야 하며 `uv run`을 지원해야 합니다. 미설정 시 context-gatherer 단계가 스킵되고 코드 분석만 진행됩니다.

### 5. Git 레포 설정

두 가지 코드 참조 모드 중 하나를 선택합니다:

**로컬 경로 모드** (이미 클론된 레포가 있는 경우):

```env
SERVICE_PROJECT_PATH=/path/to/your/service/project
```

**Git Worktree 모드** (git 태그 기반 버전별 분석용):

`SERVICE_PROJECT_PATH`를 설정하지 않고 다음 값을 설정합니다:

```env
GIT_REPO_URL=https://github.com/your-org/your-repo
GIT_DEFAULT_REF=main
# GIT_BASE_CLONE_PATH=/tmp/oncall-bot-repo        # 선택
# GIT_WORKTREE_BASE_PATH=/tmp/oncall-bot-worktrees # 선택
```

프라이빗 레포의 경우 git 인증이 설정되어 있어야 합니다 (Docker 모드에서는 `GITHUB_TOKEN` 사용).

### 6. 봇 실행

**개발 모드** (hot reload):

```bash
npm run dev
```

**프로덕션 빌드 및 실행**:

```bash
npm run build
npm start
```

**CLI 테스트 모드** (Slack 없이):

```bash
npx tsx src/cli.ts "질문 내용"
npx tsx src/cli.ts "PROJ-123 왜 500 에러가 나나요?"
npx tsx src/cli.ts "v1.2.3 배포 후 타임아웃 에러 발생"
```

### 7. Docker 설정

Docker Compose로 빌드 및 실행:

```bash
docker compose up -d
```

Docker 설정에서 처리하는 사항:
- Claude Code CLI 글로벌 설치
- `GITHUB_TOKEN`을 통한 git 인증 설정
- Atlassian MCP 서버 클론 (`ATLASSIAN_MCP_REPO_URL` 설정 시)
- non-root 사용자로 실행 (Claude Code CLI 요구사항)
- git 레포 캐시 및 MCP 서버용 영구 볼륨

Claude 인증 정보 마운트 필요:
- 호스트에서 `claude login` 실행 후 `~/.claude` 볼륨 마운트
- 또는 `ANTHROPIC_API_KEY` 환경변수 설정

### 8. 테스트 실행

```bash
# 전체 테스트 실행
npm test

# watch 모드
npm run test:watch

# 타입 체크
npx tsc --noEmit
```

## 환경변수 목록

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `SLACK_BOT_TOKEN` | O | - | Slack Bot OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | O | - | Slack App-Level Token (Socket Mode) (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | O | - | Slack Signing Secret |
| `ANTHROPIC_API_KEY` | - | - | Anthropic API 키 (Claude CLI 로그인 대안) |
| `SERVICE_PROJECT_PATH` | - | - | 로컬 서비스 프로젝트 경로 (설정 시 worktree 모드 비활성화) |
| `GIT_REPO_URL` | - | - | worktree 모드용 Git 레포 URL |
| `GIT_BASE_CLONE_PATH` | - | `{tmpdir}/oncall-bot-repo` | Bare clone 저장 경로 |
| `GIT_WORKTREE_BASE_PATH` | - | `{tmpdir}/oncall-bot-worktrees` | Worktree 생성 경로 |
| `GIT_DEFAULT_REF` | - | `develop` | 버전 미지정 시 기본 ref |
| `GITHUB_TOKEN` | - | - | 프라이빗 레포 접근용 GitHub 토큰 (Docker) |
| `ATLASSIAN_AGENT_DIR` | - | - | Atlassian MCP 서버 디렉토리 경로 |
| `ATLASSIAN_MCP_REPO_URL` | - | - | Atlassian MCP 서버 클론용 Git URL (Docker) |
| `LOG_LEVEL` | - | `info` | 로그 레벨 (`debug`, `info`, `warn`, `error`) |
| `LOG_FORMAT` | - | `plain` | 로그 포맷 (`plain`, `json`) |
| `AGENT_TIMEOUT_CONTEXT_GATHERER_MS` | - | `180000` | context-gatherer 타임아웃 (ms) |
| `AGENT_TIMEOUT_CODE_ANALYZER_MS` | - | `300000` | code-analyzer 타임아웃 (ms) |
| `AGENT_TIMEOUT_ISSUE_DIAGNOSER_MS` | - | `300000` | issue-diagnoser 타임아웃 (ms) |
| `AGENT_TIMEOUT_RESPONSE_WRITER_MS` | - | `60000` | response-writer 타임아웃 (ms) |
| `AGENT_MAX_RETRIES` | - | `2` | 에이전트 실패 시 재시도 횟수 |
| `MAX_CONCURRENT_REQUESTS` | - | `3` | 동시 처리 최대 요청 수 |

## 서브에이전트 아키텍처

봇은 4개의 전문 서브에이전트를 사용하며, 각각 `agents/` 디렉토리의 CLAUDE.md 프롬프트 파일로 정의됩니다. 각 에이전트는 Claude Agent SDK를 통해 별도의 Claude Code CLI 프로세스로 실행됩니다.

### context-gatherer

MCP 도구를 사용하여 Jira와 Confluence에서 컨텍스트를 수집합니다. 두 가지 모드로 동작합니다:
- **티켓 모드**: Jira 티켓 번호가 제공되면 해당 이슈와 관련 Confluence 페이지를 직접 조회
- **검색 모드**: 티켓 번호가 없으면 질문에서 추출한 키워드로 Jira/Confluence 검색

이 에이전트는 선택사항입니다 -- 실패하거나 MCP 서버가 미설정이면 파이프라인은 컨텍스트 없이 계속 진행됩니다.

### code-analyzer

보고된 이슈와 관련된 코드를 서비스 프로젝트에서 찾습니다. Grep, Glob, Read 도구를 사용하여 에러 메시지, API 엔드포인트, 함수명, 모듈명으로 검색합니다. 효율성을 위해 최대 15턴으로 제한됩니다.

### issue-diagnoser

원본 질문, 코드 분석 결과, Jira/Confluence 컨텍스트, 버전 diff를 종합하여 근본 원인을 진단합니다. 이슈를 다음과 같이 분류합니다: `bug`, `config`, `infra`, `data`, `dependency`, `usage`, `unknown`.

### response-writer

진단 결과를 Slack mrkdwn 형식의 메시지 (2000자 이내)로 변환합니다. 카테고리별 이모지, 확신도, 요약, 원인 분석, 영향 범위, 권장 조치를 포함합니다.

## 프로젝트 구조

```
oncall-bot/
+-- src/
|   +-- index.ts                  # 엔트리포인트 (봇 시작 + repo 초기화)
|   +-- cli.ts                    # CLI 테스트 실행기 (Slack 없이)
|   +-- config/
|   |   +-- index.ts              # 환경변수 설정 관리
|   +-- slack/
|   |   +-- app.ts                # Slack Bolt 앱 인스턴스 (Socket Mode)
|   |   +-- handlers.ts           # 멘션/DM 이벤트 핸들러
|   +-- agent/
|   |   +-- orchestrator.ts       # 4단계 에이전트 파이프라인 오케스트레이션
|   |   +-- output-parser.ts      # 에이전트 출력 JSON 파싱
|   |   +-- __tests__/
|   +-- utils/
|       +-- agent-runner.ts       # Claude Agent SDK 래퍼
|       +-- git-repo.ts           # Git bare clone / worktree 관리
|       +-- message-parser.ts     # 버전 태그 + Jira 티켓 파싱
|       +-- version-selector.ts   # 버전 선택 우선순위 로직
|       +-- errors.ts             # 커스텀 에러 타입
|       +-- logger.ts             # 구조화 로거 (plain / JSON)
|       +-- retry.ts              # 지수 백오프 재시도 유틸리티
|       +-- semaphore.ts          # 동시성 제어
|       +-- __tests__/
+-- agents/                       # 서브에이전트 CLAUDE.md 정의
|   +-- CLAUDE.md                 # 공통 에이전트 지침
|   +-- context-gatherer/
|   |   +-- CLAUDE.md             # Jira/Confluence 컨텍스트 수집
|   +-- code-analyzer/
|   |   +-- CLAUDE.md             # 코드 탐색 및 분석
|   +-- issue-diagnoser/
|   |   +-- CLAUDE.md             # 원인 진단
|   +-- response-writer/
|       +-- CLAUDE.md             # Slack 응답 포맷팅
+-- .env.example
+-- docker-compose.yml
+-- Dockerfile
+-- docker-entrypoint.sh
+-- package.json
+-- tsconfig.json
+-- vitest.config.ts
```

## 라이선스

MIT
