#!/bin/bash

echo "========================================"
echo "  ResQCart — Stopping All Services"
echo "========================================"
echo ""

# Kill by port
for PORT in 3000 3001 8000 5173; do
    PID=$(lsof -ti :"$PORT" 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "  Killing port $PORT (PID $PID)..."
        kill -9 "$PID" 2>/dev/null
    else
        echo "  Port $PORT: already free"
    fi
done

# Kill by process name (catches nodemon, uvicorn, vite)
for PROC in uvicorn nodemon vite; do
    PIDS=$(pgrep -f "$PROC" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "  Killing $PROC (PIDs: $PIDS)..."
        kill -9 $PIDS 2>/dev/null
    fi
done

echo ""
echo "========================================"
echo "  All services stopped"
echo "========================================"
