#!/bin/bash

# Food Check AI — start all services
# Ports: Frontend=5173, Backend=3000, AIML=8000, MongoDB=27017

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  Food Check AI — Starting All Services"
echo "========================================"
echo ""

# ── MongoDB check ────────────────────────────
echo "[1/4] Checking MongoDB..."
if ! pgrep -x mongod >/dev/null 2>&1; then
    echo "  MongoDB not running. Starting..."
    sudo systemctl start mongod
    sleep 2
fi
if pgrep -x mongod >/dev/null 2>&1; then
    echo "  MongoDB: OK (port 27017)"
else
    echo "  ERROR: MongoDB failed to start. Run: sudo systemctl start mongod"
    exit 1
fi

# ── Port check helper ─────────────────────────
port_free() {
    ! lsof -Pi :"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

# ── Kill leftovers on our ports ───────────────
for PORT in 3000 8000 5173; do
    PID=$(lsof -ti :"$PORT" 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "  Killing stale process on port $PORT (PID $PID)..."
        kill -9 "$PID" 2>/dev/null
        sleep 1
    fi
done

echo ""

# ── AIML service (FastAPI + uvicorn) ─────────
echo "[2/4] Starting AIML service (port 8000)..."
cd "$ROOT_DIR/aiml"
if [ ! -d "venv" ]; then
    echo "  Creating venv..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt -q
else
    source venv/bin/activate
fi
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload > /tmp/foodcheckai-aiml.log 2>&1 &
AIML_PID=$!
echo "  AIML PID: $AIML_PID  (log: /tmp/foodcheckai-aiml.log)"

# ── Backend (Express + nodemon) ───────────────
echo "[3/4] Starting backend (port 3000)..."
cd "$ROOT_DIR/backend"
npm run dev > /tmp/foodcheckai-backend.log 2>&1 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID  (log: /tmp/foodcheckai-backend.log)"

# ── Frontend (Vite) ───────────────────────────
echo "[4/4] Starting frontend (port 5173)..."
cd "$ROOT_DIR/frontend"
npm run dev > /tmp/foodcheckai-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID  (log: /tmp/foodcheckai-frontend.log)"

# ── Wait for services to come up ─────────────
echo ""
echo "Waiting for services..."
sleep 5

echo ""
echo "========================================"
echo "  All services running"
echo "========================================"
echo ""
echo "  Frontend  →  http://localhost:5173"
echo "  Backend   →  http://localhost:3000"
echo "  AIML      →  http://localhost:8000"
echo "  MongoDB   →  localhost:27017  (foodcheckai)"
echo ""
echo "  Logs:"
echo "    AIML    : /tmp/foodcheckai-aiml.log"
echo "    Backend : /tmp/foodcheckai-backend.log"
echo "    Frontend: /tmp/foodcheckai-frontend.log"
echo ""
echo "  Press Ctrl+C to stop all services"
echo "========================================"

# ── Cleanup on exit ───────────────────────────
cleanup() {
    echo ""
    echo "Stopping all services..."
    kill "$AIML_PID"     2>/dev/null
    kill "$BACKEND_PID"  2>/dev/null
    kill "$FRONTEND_PID" 2>/dev/null
    deactivate 2>/dev/null
    echo "Done."
    exit 0
}
trap cleanup SIGINT SIGTERM

wait
