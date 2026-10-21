#!/usr/bin/env bash
# Bring a restored workspace back to a working state, then leave a healthy dev
# server behind.
#
#   ./scripts/dev-setup.sh --host <preview-host>   # dependencies, Chromium, dev server
#   ./scripts/dev-setup.sh --no-browser            # skip Playwright/Chromium setup
#   ./scripts/dev-setup.sh --no-server             # prepare only, start nothing
#   ./scripts/dev-setup.sh --force                 # reinstall dependencies anyway
#   ./scripts/dev-setup.sh --stop                  # stop the server this script started
#
# A Cloud restore keeps tracked files but loses node_modules, the Playwright
# browser cache and any running process, and the preview hostname changes. This
# script restores all three and refuses to call the server healthy until it
# answers an HTTP request on the real preview hostname.
#
# Re-run it after every restore, from the repository root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_FILE="$ROOT/.dev-server.env"
LOG_FILE="$ROOT/.dev-server.log"
PID_FILE="$ROOT/.dev-server.pid"

HOST="${LEEWARD_PREVIEW_HOST:-}"
PORT="${LEEWARD_PORT:-}"
START_SERVER=1
SETUP_BROWSER=1
FORCE_INSTALL=0
STOP=0

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
}

fail() {
  echo "error: $*" >&2
  exit 1
}

need_value() {
  [ -n "${2:-}" ] || fail "$1 needs a value"
  printf '%s' "$2"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --host=*) HOST="${1#*=}"; shift ;;
    --port) PORT="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --no-server) START_SERVER=0; shift ;;
    --no-browser) SETUP_BROWSER=0; shift ;;
    --force) FORCE_INSTALL=1; shift ;;
    --stop) STOP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown option: $1" ;;
  esac
done

# Values from the last run are only defaults; flags and the environment win.
state_value() {
  [ -f "$STATE_FILE" ] || return 0
  sed -n "s/^$1=//p" "$STATE_FILE" | tail -n 1
}
[ -n "$PORT" ] || PORT="$(state_value LEEWARD_PORT)"
[ -n "$HOST" ] || HOST="$(state_value LEEWARD_PREVIEW_HOST)"
PORT="${PORT:-3000}"
# Accept a pasted URL as well as a bare hostname.
HOST="${HOST#https://}"
HOST="${HOST#http://}"
HOST="${HOST%%/*}"

case "$PORT" in
  ''|*[!0-9]*) fail "port must be a number, got '$PORT'" ;;
esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "port must be between 1024 and 65535"

# Where the server is listening on TCP, judged by the kernel rather than by a
# log banner. Prints "address:port" or nothing.
port_listener() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v p=":$PORT" '$4 ~ p"$" { print $4; exit }'
  else
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
      exec 3>&- 2>/dev/null || true
      echo "127.0.0.1:$PORT"
    fi
  fi
}

# GET a URL, optionally with an explicit Host header (the preview validates it).
# Sets HTTP_CODE and HTTP_BODY; returns non-zero when the request fails outright.
HTTP_CODE=0
HTTP_BODY=''
http_get() {
  local url="$1" host="${2:-}" response
  HTTP_CODE=0
  HTTP_BODY=''
  if [ -n "$host" ]; then
    response="$(curl -sS --max-time 5 -H "Host: $host" -w $'\n%{http_code}' "$url" 2>/dev/null)" ||
      return 1
  else
    response="$(curl -sS --max-time 5 -w $'\n%{http_code}' "$url" 2>/dev/null)" || return 1
  fi
  HTTP_CODE="${response##*$'\n'}"
  HTTP_BODY="${response%$'\n'*}"
  return 0
}

# The chart itself, not just any 200: the document must be LEEWARD's index.
# The two markers are checked separately because the title precedes the root
# element, so a single ordered pattern would never match.
is_app_response() {
  case "$HTTP_BODY" in
    *'<div id="root">'*) ;;
    *) return 1 ;;
  esac
  case "$HTTP_BODY" in
    *LEEWARD*) return 0 ;;
    *) return 1 ;;
  esac
}

stop_server() {
  [ -f "$PID_FILE" ] || fail "no PID file at $PID_FILE; nothing to stop"
  local pid cmd cwd waited=0
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  case "$pid" in
    ''|*[!0-9]*) fail "PID file is corrupt: $PID_FILE" ;;
  esac
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "dev server (pid $pid) is already gone; removing stale PID file"
    rm -f "$PID_FILE"
    return 0
  fi
  # Never signal a process that only happens to hold the recorded PID.
  cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  case "$cmd" in
    *vite*|*"npm run dev"*) ;;
    *) fail "refusing to stop pid $pid: it is not this dev server ($cmd)" ;;
  esac
  [ "$cwd" = "$ROOT" ] || fail "refusing to stop pid $pid: it runs in ${cwd:-unknown}"

  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  while [ "$waited" -lt 40 ]; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "dev server did not exit on TERM; sending KILL" >&2
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  while [ -n "$(port_listener)" ]; do
    [ "$waited" -lt 80 ] || fail "port $PORT is still listening after stopping the server"
    sleep 0.25
    waited=$((waited + 1))
  done
  echo "dev server stopped; port $PORT is free"
}

[ "$STOP" -eq 1 ] && { stop_server; exit 0; }

# ---------------------------------------------------------------------------
# 1. Toolchain
# ---------------------------------------------------------------------------
command -v node >/dev/null 2>&1 || fail "node is not installed"
command -v npm >/dev/null 2>&1 || fail "npm is not installed"
command -v curl >/dev/null 2>&1 || fail "curl is not installed (used for the health check)"
echo "==> node $(node -v), npm $(npm -v)"

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  process.exit(major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19) ? 0 : 1);
' || fail "Node 20.19+ or 22.12+ is required by Vite 7 (found $(node -v))"

# ---------------------------------------------------------------------------
# 2. Dependencies
# ---------------------------------------------------------------------------
deps_ok() {
  [ "$FORCE_INSTALL" -eq 0 ] || return 1
  [ -f node_modules/.package-lock.json ] || return 1
  [ -x node_modules/.bin/vite ] || return 1
  [ -x node_modules/.bin/vitest ] || return 1
  [ -x node_modules/.bin/playwright ] || return 1
  # package-lock.json is newer than the install tree, so the tree is stale.
  [ ! package-lock.json -nt node_modules/.package-lock.json ] || return 1
  [ ! package.json -nt node_modules/.package-lock.json ] || return 1
  return 0
}

if deps_ok; then
  echo "==> dependencies: already installed"
else
  echo "==> dependencies: installing from package-lock.json"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi
[ -x node_modules/.bin/vite ] || fail "node_modules/.bin/vite is still missing after install"

# ---------------------------------------------------------------------------
# 3. Headless browser: Chromium plus the shared libraries and fonts it needs
# ---------------------------------------------------------------------------
chrome_path=''
find_chrome() {
  chrome_path="$(node --input-type=module -e \
    "import { chromium } from 'playwright'; process.stdout.write(chromium.executablePath())" \
    2>/dev/null || true)"
  [ -n "$chrome_path" ] && [ -x "$chrome_path" ]
}

setup_browser() {
  # A previous restore leaves its prefix and environment behind; honour them so
  # a re-run does not re-download every library.
  if [ -f scripts/browser-env.sh ]; then . scripts/browser-env.sh; fi

  if find_chrome; then
    echo "==> chromium: $chrome_path"
  else
    echo "==> chromium: installing (playwright install chromium)"
    node_modules/.bin/playwright install chromium
    find_chrome || fail "Playwright could not resolve a Chromium binary after install"
  fi

  local missing
  missing="$(ldd "$chrome_path" 2>/dev/null | grep -c 'not found' || true)"
  if [ "${missing:-0}" -gt 0 ]; then
    echo "==> browser libraries: $missing missing, restoring into .browser-deps/"
    if [ -x scripts/setup-browser-deps.sh ]; then
      scripts/setup-browser-deps.sh
    elif [ -f scripts/setup-browser-deps.sh ]; then
      bash scripts/setup-browser-deps.sh
    else
      fail "chromium needs $missing shared libraries and scripts/setup-browser-deps.sh is missing"
    fi
    if [ -f scripts/browser-env.sh ]; then . scripts/browser-env.sh; fi
    missing="$(ldd "$chrome_path" 2>/dev/null | grep -c 'not found' || true)"
    [ "${missing:-0}" -eq 0 ] ||
      fail "chromium still misses $missing shared libraries; add their packages to scripts/setup-browser-deps.sh"
  else
    echo "==> browser libraries: already present in .browser-deps/"
  fi

  # A launched browser with real text metrics proves both the libraries and the
  # fonts work; the UI checks measure the wordmark and fail on a zero-height box.
  echo "==> chromium: smoke test"
  node --input-type=module -e "
    import { chromium } from 'playwright';
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent('<div style=\"font:16px sans-serif\">LEEWARD</div>');
    const height = await page.evaluate(() => document.body.firstElementChild.getBoundingClientRect().height);
    await browser.close();
    if (!(height > 0)) {
      console.error('no usable font: text laid out at ' + height + 'px');
      process.exit(1);
    }
  " || fail "headless Chromium cannot render text; run ./scripts/setup-browser-deps.sh and retry"
}

if [ "$SETUP_BROWSER" -eq 1 ]; then
  setup_browser
else
  echo "==> chromium: skipped (--no-browser)"
  if [ -f scripts/browser-env.sh ]; then . scripts/browser-env.sh; fi
fi

# ---------------------------------------------------------------------------
# 4. Dev server
# ---------------------------------------------------------------------------
if [ "$START_SERVER" -eq 0 ]; then
  echo "==> dev server: skipped (--no-server)"
  exit 0
fi

if [ -z "$HOST" ]; then
  echo "==> preview host: unknown; pass --host <hostname> so the Cloud preview is allowed" >&2
fi

describe_port_owner() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p"$" { print; exit }'
  fi
  return 0
}

reuse_server() {
  echo "==> dev server: reusing the one already on port $PORT"
}

if [ -n "$(port_listener)" ]; then
  if http_get "http://127.0.0.1:$PORT/" && [ "$HTTP_CODE" = "200" ] && is_app_response; then
    reuse_server
    if [ -f "$PID_FILE" ]; then
      echo "    pid $(cat "$PID_FILE") (from $PID_FILE)"
    else
      echo "    started outside this script; $PID_FILE has no record of it"
    fi
  else
    echo "port $PORT is held by something that is not this chartplotter:" >&2
    describe_port_owner >&2
    fail "free port $PORT (or pass --port) instead of stopping an unrelated process"
  fi
else
  echo "==> dev server: starting on port $PORT"
  rm -f "$PID_FILE"
  : >"$LOG_FILE"
  if command -v setsid >/dev/null 2>&1; then
    LEEWARD_PORT="$PORT" LEEWARD_PREVIEW_HOST="$HOST" \
      setsid nohup npm run dev >>"$LOG_FILE" 2>&1 </dev/null &
  else
    LEEWARD_PORT="$PORT" LEEWARD_PREVIEW_HOST="$HOST" \
      nohup npm run dev >>"$LOG_FILE" 2>&1 </dev/null &
  fi
  server_pid=$!
  echo "$server_pid" >"$PID_FILE"

  deadline=$((SECONDS + 90))
  until http_get "http://127.0.0.1:$PORT/" && [ "$HTTP_CODE" = "200" ] && is_app_response; do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      echo "--- last lines of $LOG_FILE ---" >&2
      tail -n 40 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      fail "dev server exited during startup (pid $server_pid)"
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "--- last lines of $LOG_FILE ---" >&2
      tail -n 40 "$LOG_FILE" >&2 || true
      fail "dev server did not answer on http://127.0.0.1:$PORT/ within 90s (pid $server_pid in $PID_FILE)"
    fi
    sleep 0.5
  done
  echo "==> dev server: ready (pid $server_pid, log $LOG_FILE)"
fi

# Vite must be reachable from outside the VM, not only from loopback.
listener="$(port_listener)"
case "$listener" in
  *0.0.0.0*|*'[::]'*) ;;
  '') fail "nothing is listening on port $PORT after startup" ;;
  *) fail "dev server listens on $listener, not 0.0.0.0; the preview cannot reach it" ;;
esac

# The preview hostname is validated per request, so the only meaningful health
# check is one that carries it.
if [ -n "$HOST" ]; then
  if http_get "http://127.0.0.1:$PORT/" "$HOST"; then
    case "$HTTP_CODE" in
      200)
        is_app_response || fail "preview host $HOST got a 200 that is not the LEEWARD index"
        echo "==> preview host: $HOST accepted"
        ;;
      *)
        if [ -f "$PID_FILE" ]; then
          fail "preview host $HOST answered $HTTP_CODE; the server was started for a different host. Run --stop, then re-run with the hostname this workspace currently has"
        fi
        fail "preview host $HOST answered $HTTP_CODE; pass the hostname this workspace currently has via --host"
        ;;
    esac
  else
    fail "preview host $HOST did not answer at all; check the hostname and retry"
  fi
fi

# A 200 only proves Vite served a document. Load it in the browser it is meant
# for and wait for React to mount, so a broken bundle is not reported healthy.
if [ "$SETUP_BROWSER" -eq 1 ]; then
  echo "==> app: loading the chart in headless Chromium"
  CHECK_URL="http://127.0.0.1:$PORT/" node --input-type=module -e "
    import { chromium } from 'playwright';
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(process.env.CHECK_URL, { waitUntil: 'load', timeout: 30000 });
      await page.waitForSelector('#root > *', { timeout: 20000 });
      const title = await page.title();
      if (!title.includes('LEEWARD')) throw new Error('unexpected title: ' + title);
      if (errors.length) throw new Error('uncaught page error: ' + errors[0]);
    } finally {
      await browser.close();
    }
  " || fail "the chart did not mount in Chromium; see $LOG_FILE and the page error above"
  echo "==> app: React mounted, chart document titled LEEWARD"
fi

# Remember the port/host so the next restore only needs --host if it changed.
{
  printf 'LEEWARD_PORT=%s\n' "$PORT"
  printf 'LEEWARD_PREVIEW_HOST=%s\n' "$HOST"
} >"$STATE_FILE"

if ! grep -q '^AISSTREAM_API_KEY=.' "$ROOT/.env.local" 2>/dev/null &&
  [ -z "${AISSTREAM_API_KEY:-}" ]; then
  echo "note: no AISSTREAM_API_KEY in .env.local or the environment; AIS shows simulated traffic"
fi

echo
echo "chart:   http://localhost:$PORT/"
if [ -n "$HOST" ]; then echo "preview: https://$HOST/"; fi
echo "verify:  source scripts/browser-env.sh && node scripts/verify-ui.mjs"
echo "stop:    ./scripts/dev-setup.sh --stop"
