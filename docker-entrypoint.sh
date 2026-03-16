#!/bin/sh
set -e

HOME_DIR="$(eval echo ~)"

# ──────────────────────────────────────────────
# 1. Git credential 설정 (프라이빗 레포 clone용)
# ──────────────────────────────────────────────
if [ -n "$GITHUB_TOKEN" ]; then
  echo "Setting up Git credentials..."
  git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'
  git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# ──────────────────────────────────────────────
# 2. Atlassian MCP 서버 클론 (context-gatherer용)
# ──────────────────────────────────────────────
MCP_SERVER_DIR="${ATLASSIAN_AGENT_DIR:-/opt/atlassian-mcp-server}"
if [ ! -d "$MCP_SERVER_DIR/atlassian_mcp" ]; then
  echo "Cloning Atlassian MCP server..."
  if [ -n "$ATLASSIAN_MCP_REPO_URL" ]; then
    git clone "$ATLASSIAN_MCP_REPO_URL" "$MCP_SERVER_DIR" 2>/dev/null || \
      echo "WARN: Failed to clone Atlassian MCP server. context-gatherer will be skipped."
  else
    echo "WARN: ATLASSIAN_MCP_REPO_URL not set. context-gatherer will be skipped."
  fi
fi

# ──────────────────────────────────────────────
# 3. Claude 인증 확인
#    SDK가 내부적으로 cli.js를 spawn하며,
#    ~/.claude/ 디렉토리의 인증 정보를 사용한다.
# ──────────────────────────────────────────────
CLAUDE_DIR="${HOME_DIR}/.claude"
if [ -z "$ANTHROPIC_API_KEY" ] && [ ! -f "${CLAUDE_DIR}/.credentials.json" ]; then
  echo "ERROR: Claude 인증 정보가 없습니다."
  echo "  - ~/.claude 볼륨 마운트 (claude login 인증) 또는"
  echo "  - ANTHROPIC_API_KEY 환경변수 설정이 필요합니다."
  exit 1
fi

# 볼륨 마운트 없이 API key만 사용하는 경우 settings.json 생성
if [ ! -f "${CLAUDE_DIR}/settings.json" ]; then
  mkdir -p "${CLAUDE_DIR}"
  echo '{}' > "${CLAUDE_DIR}/settings.json"
fi

# ──────────────────────────────────────────────
# 4. 앱 실행
# ──────────────────────────────────────────────
exec node dist/index.js
