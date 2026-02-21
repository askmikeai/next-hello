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

## Docker Volumes

| Volume | Purpose |
|--------|---------|
| `nexthello-whatsapp-auth` | Stores WhatsApp session credentials |
| `/tmp` (bind mount) | QR code output accessible from host |

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

## File Structure

```
whatsapp-bridge/
├── index.js          # Main bridge code (whatsapp-web.js)
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
