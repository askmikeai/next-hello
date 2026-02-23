# WhatsApp Bridge

Node.js bridge that connects WhatsApp to the NextHello Python API using **whatsapp-web.js** (Puppeteer-based).

## How It Works

This bridge uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) which controls a headless Chromium browser to connect to web.whatsapp.com. This approach is more stable than direct WebSocket libraries because it uses the actual WhatsApp Web interface.

## Prerequisites

- Docker and Docker Compose installed
- PostgreSQL and Redis containers running (for the full stack)

## Quick Start

### Step 1: Build the WhatsApp Bridge Image

```bash
docker compose build whatsapp-connect
```

### Step 2: Run the WhatsApp Connect Tool

```bash
docker compose run --rm whatsapp-connect
```

This will:
1. Launch a headless Chromium browser
2. Open WhatsApp Web
3. Generate a QR code in your terminal
4. Save the QR code to `/tmp/whatsapp-qr.txt`

### Step 3: Scan the QR Code

Open WhatsApp on your phone:
1. Go to **Settings** → **Linked Devices**
2. Tap **Link a Device**
3. Scan the QR code displayed in the terminal

If the terminal QR code is hard to read:
```bash
cat /tmp/whatsapp-qr.txt
```

### Step 4: Verify Connection

Once connected, you'll see:
```
✅ WhatsApp connected! Listening for messages...
```

Press `Ctrl+C` to exit the connect tool.

### Step 5: Start the WhatsApp Bridge Service

After authentication, start the bridge as a background service:

```bash
docker compose up -d whatsapp-bridge
```

The bridge will automatically reconnect using saved credentials.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   WhatsApp      │────▶│  whatsapp-web.js │────▶│   Python API    │
│   (Phone)       │◀────│  + Chromium      │◀────│   (FastAPI)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                        /tmp/whatsapp-qr.txt
```

1. **Chromium Browser**: Runs headlessly inside Docker
2. **whatsapp-web.js**: Controls the browser, connects to web.whatsapp.com
3. **QR Code**: Displayed in terminal and saved to file
4. **Message Flow**: Incoming messages forwarded to Python API at `/bridge/message`
5. **Responses**: API responses sent back through WhatsApp

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHON_API_URL` | `http://localhost:8001` | URL of the Python API |
| `QR_OUTPUT_DIR` | `/tmp` | Directory to save QR code file |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` | Path to Chromium |
| `DATABASE_URL` | (none) | PostgreSQL connection string for session backup |
| `SESSION_ID` | `default` | Unique identifier for this WhatsApp session |
| `DATABASE_SSL` | `false` | Set to `true` for SSL connections (cloud databases) |

## Docker Volumes

| Volume | Purpose |
|--------|---------|
| `nexthello-whatsapp-auth` | Stores WhatsApp session credentials |
| `/tmp` (bind mount) | QR code output accessible from host |

## PostgreSQL Session Persistence

WhatsApp sessions are valuable and can be difficult to re-create (Meta limits new connections). This bridge supports backing up sessions to PostgreSQL for:

- **Cloud portability**: Sessions survive container rebuilds and deployments
- **Disaster recovery**: Restore sessions on new infrastructure
- **Multi-environment**: Share sessions between local and cloud environments

### How It Works

```
┌─────────────────┐      Backup (tar.gz + base64)     ┌─────────────────┐
│  Local Session  │──────────────────────────────────▶│   PostgreSQL    │
│  (Chromium)     │◀──────────────────────────────────│   whatsapp_     │
└─────────────────┘      Restore (on startup)         │   sessions      │
                                                      └─────────────────┘
```

1. **On Authentication**: Session files compressed and stored in PostgreSQL
2. **On Startup**: If no local session exists, restores from PostgreSQL
3. **On Shutdown**: Backs up current session before exit

### Setup

1. Run database migrations:
   ```bash
   docker compose --profile migrations run --rm liquibase
   ```

2. Ensure `DATABASE_URL` is set in your environment or `.env` file

3. Start the WhatsApp bridge - it will automatically:
   - Check for existing remote session
   - Restore if local session is missing
   - Backup after successful authentication

### HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/session/status` | GET | Check local and remote session status |
| `/session/backup` | POST | Manually backup session to PostgreSQL |
| `/session/restore` | POST | Restore session from PostgreSQL (requires restart) |
| `/health` | GET | Health check with connection status |

### Example: Check Session Status

```bash
curl http://localhost:3000/session/status
```

Response:
```json
{
  "sessionId": "default",
  "hasLocal": true,
  "hasRemote": true,
  "postgresConfigured": true
}
```

### Example: Manual Backup

```bash
curl -X POST http://localhost:3000/session/backup
```

### Migrating to a New Environment

1. Ensure PostgreSQL has the session backed up
2. Deploy with same `DATABASE_URL` and `SESSION_ID`
3. Bridge will automatically restore the session on startup

## Commands Reference

```bash
# Build the image
docker compose build whatsapp-connect

# Connect WhatsApp (interactive, shows QR code)
docker compose run --rm whatsapp-connect

# View saved QR code
cat /tmp/whatsapp-qr.txt

# Start bridge as background service
docker compose up -d whatsapp-bridge

# View bridge logs
docker compose logs -f whatsapp-bridge

# Restart bridge
docker compose restart whatsapp-bridge

# Stop bridge
docker compose stop whatsapp-bridge

# Re-authenticate (clear saved session)
docker volume rm nexthello-whatsapp-auth
docker compose run --rm whatsapp-connect
```

## Troubleshooting

### QR Code Not Appearing

1. Ensure Docker has enough resources (Chromium needs ~512MB RAM)
2. Check container logs:
   ```bash
   docker compose logs whatsapp-connect
   ```
3. View the saved QR file: `cat /tmp/whatsapp-qr.txt`

### "Could Not Connect" After Scanning

This can happen with direct WebSocket libraries. whatsapp-web.js (Puppeteer-based) is more reliable because it uses the actual WhatsApp Web interface.

### Connection Keeps Dropping

1. Check the logs for errors:
   ```bash
   docker compose logs -f whatsapp-bridge
   ```
2. WhatsApp may have logged out the device. Re-authenticate:
   ```bash
   docker volume rm nexthello-whatsapp-auth
   docker compose run --rm whatsapp-connect
   ```

### Browser Crashes

If Chromium crashes, try increasing Docker memory limits or check for:
- `/dev/shm` size (should be at least 64MB)
- Sandbox issues (we use `--no-sandbox` flag)

## Features

- **QR Code Authentication**: Scan once, stays connected
- **Message Forwarding**: All incoming messages sent to Python API
- **Auto-Reply**: API responses automatically sent back
- **Call Rejection**: Incoming calls rejected with polite message
- **Media Support**: Handles images, videos, audio, documents
- **Persistent Sessions**: Credentials saved to Docker volume
- **PostgreSQL Backup**: Sessions backed up to database for cloud portability
- **Graceful Shutdown**: Sessions saved on SIGTERM/SIGINT

## File Structure

```
whatsapp-bridge/
├── index.js          # Main bridge code (whatsapp-web.js)
├── pg-store.js       # PostgreSQL session backup/restore
├── package.json      # Node.js dependencies
├── Dockerfile        # Container with Chromium
└── README.md         # This file
```

## Why whatsapp-web.js?

We switched from Baileys to whatsapp-web.js because:

| Feature | Baileys | whatsapp-web.js |
|---------|---------|-----------------|
| Connection Method | Direct WebSocket | Puppeteer/Browser |
| Stability | Breaks with WA updates | More stable |
| QR Code Issues | Common 405 errors | Reliable |
| Resource Usage | Lightweight | Heavier (runs Chrome) |
| Detection Risk | Higher | Lower |

whatsapp-web.js uses the actual WhatsApp Web interface, making it more resistant to protocol changes.
