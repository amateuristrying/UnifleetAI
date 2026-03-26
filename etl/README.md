# Unifleet Live Telemetry ETL Pipeline

## Architecture

```
Navixy WebSocket (state_batch)
        │
        ▼
  Node.js ETL Worker (runs 24/7)
        │
        ▼
  Supabase PostgreSQL
    ├── vehicle_latest_state  (upsert — always current)
    └── vehicle_telemetry     (append — time-series history)
        │
        ▼
  Frontend (reads from Supabase)
```

## Components

1. **`worker.js`** — Long-running Node.js process that:
   - Authenticates with Navixy API
   - Opens WebSocket to `wss://api.navixy.com/v2/event/subscription`
   - Subscribes to `state_batch` for all trackers
   - Writes every state update to Supabase in real-time

2. **`schema.sql`** — Supabase table definitions

## Running

```bash
# Install deps
cd etl && npm install

# Run the worker (keeps running forever)
npm start

# Or for development with auto-restart
npm run dev
```

## Deployment Options

- **Local**: Run `npm start` on any always-on machine
- **AWS EC2**: Deploy as a systemd service
- **Railway/Render**: Deploy as a background worker
- **PM2**: `pm2 start worker.js --name unifleet-etl`
