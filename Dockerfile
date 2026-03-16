FROM node:20-slim

# ──────────────────────────────────────────────
# 시스템 의존성
#   - git: bare clone + worktree (clones target repo at runtime)
#   - python3 + venv: Atlassian MCP 서버 실행 (uv가 사용)
#   - curl: uv 설치용
# ──────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-venv \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ──────────────────────────────────────────────
# non-root 사용자 생성
#   Claude Code CLI는 root에서 --dangerously-skip-permissions를 차단한다
# ──────────────────────────────────────────────
RUN useradd -m -s /bin/sh appuser

# ──────────────────────────────────────────────
# uv (Python 패키지 매니저)
#   context-gatherer가 MCP 서버를 실행할 때 사용:
#   uv run --directory /opt/atlassian-mcp-server python -m atlassian_mcp
# ──────────────────────────────────────────────
USER appuser
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
USER root
ENV PATH="/home/appuser/.local/bin:$PATH"

# ──────────────────────────────────────────────
# Claude Code CLI (Agent SDK가 내부적으로 spawn)
# ──────────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code

# ──────────────────────────────────────────────
# 앱 빌드
# ──────────────────────────────────────────────
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts ./
COPY src/ src/
COPY agents/ agents/

RUN npm run build

# ──────────────────────────────────────────────
# 런타임 디렉토리 권한 설정
# ──────────────────────────────────────────────
RUN mkdir -p /tmp/oncall-bot-repo /tmp/oncall-bot-worktrees /opt/atlassian-mcp-server \
  && chown -R appuser:appuser /app /tmp/oncall-bot-repo /tmp/oncall-bot-worktrees /opt/atlassian-mcp-server

# ──────────────────────────────────────────────
# 엔트리포인트 (non-root)
# ──────────────────────────────────────────────
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER appuser
ENTRYPOINT ["/docker-entrypoint.sh"]
