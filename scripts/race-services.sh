#!/usr/bin/env bash
# Start / stop HighLife inference API + Supabase worker on RACE.
#
# Usage:
#   ./scripts/race-services.sh start
#   ./scripts/race-services.sh stop
#   ./scripts/race-services.sh status
#   ./scripts/race-services.sh logs
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INF="$REPO/services/inference"
VENV="$INF/.venv"
PID_DIR="$REPO/.race-pids"
LOG_DIR="$REPO/.race-logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

die() { echo "ERROR: $*" >&2; exit 1; }

require_venv() {
  [[ -x "$VENV/bin/python" ]] || die "Missing $VENV — run ./scripts/setup-race.sh first"
  [[ -f "$INF/.env" ]] || die "Missing $INF/.env — copy from .env.example and configure Supabase"
}

activate() {
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
  cd "$INF"
}

is_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] || return 1
  local pid
  pid="$(cat "$pidfile")"
  kill -0 "$pid" 2>/dev/null
}

start_api() {
  local pidfile="$PID_DIR/inference-api.pid"
  if is_running "$pidfile"; then
    echo "Inference API already running (PID $(cat "$pidfile"))"
    return 0
  fi
  activate
  nohup "$VENV/bin/uvicorn" app.api:app \
    --host 127.0.0.1 --port 8000 \
    >>"$LOG_DIR/inference-api.log" 2>&1 &
  echo $! >"$pidfile"
  echo "Inference API started (PID $(cat "$pidfile")) → http://127.0.0.1:8000/health"
}

start_worker() {
  local pidfile="$PID_DIR/worker.pid"
  if is_running "$pidfile"; then
    echo "Worker already running (PID $(cat "$pidfile"))"
    return 0
  fi
  activate
  nohup "$VENV/bin/python" -m app.worker \
    --device cuda \
    --poll-interval 10 \
    --batch-size 2 \
    --lease-seconds 180 \
    >>"$LOG_DIR/worker.log" 2>&1 &
  echo $! >"$pidfile"
  echo "Worker started (PID $(cat "$pidfile"))"
}

stop_one() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [[ ! -f "$pidfile" ]]; then
    echo "$name: not running"
    return 0
  fi
  local pid
  pid="$(cat "$pidfile")"
  if kill "$pid" 2>/dev/null; then
    echo "Stopped $name (PID $pid)"
  else
    echo "$name: stale PID $pid"
  fi
  rm -f "$pidfile"
}

cmd="${1:-}"
case "$cmd" in
  start)
    require_venv
    start_api
    start_worker
    ;;
  stop)
    stop_one worker
    stop_one inference-api
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    if curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1; then
      curl -s http://127.0.0.1:8000/health | python3 -m json.tool
    else
      echo "Inference API: not responding on 127.0.0.1:8000"
    fi
    for name in inference-api worker; do
      pidfile="$PID_DIR/$name.pid"
      if is_running "$pidfile"; then
        echo "$name: running (PID $(cat "$pidfile"))"
      else
        echo "$name: stopped"
        rm -f "$pidfile"
      fi
    done
    ;;
  logs)
    tail -f "$LOG_DIR/inference-api.log" "$LOG_DIR/worker.log"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
