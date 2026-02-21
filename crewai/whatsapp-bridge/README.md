# WhatsApp Bridge

Node.js bridge that connects WhatsApp to the NextHello Python API using the Baileys library.

## Prerequisites

- Docker and Docker Compose installed
- PostgreSQL and Redis containers running

## Step-by-Step: Connect WhatsApp

### Step 1: Start Required Services

Make sure PostgreSQL and Redis are running:

```bash
docker compose up -d postgres redis
```

### Step 2: Build the WhatsApp Bridge Image

```bash
docker compose build whatsapp-connect
```

### Step 3: Run the WhatsApp Connect Tool

Run the interactive WhatsApp connection tool:

```bash
docker compose run --rm whatsapp-connect
```

This will:
1. Generate a QR code displayed in your terminal
2. Save the QR code to `/tmp/whatsapp-qr.txt` on your host machine

### Step 4: Scan the QR Code

Open WhatsApp on your phone:
1. Go to **Settings** > **Linked Devices**
2. Tap **Link a Device**
3. Scan the QR code displayed in the terminal

### Step 5: View QR Code from File (Optional)

If the terminal output is hard to read, you can view the saved QR code:

```bash
cat /tmp/whatsapp-qr.txt
```

Or open it in a text editor that uses a monospace font.

### Step 6: Verify Connection

Once connected, you'll see:
```
WhatsApp connected! Listening for messages...
```

You can now press `Ctrl+C` to exit the connect tool.

### Step 7: Start the WhatsApp Bridge Service

After authentication, start the bridge service:

```bash
docker compose up -d whatsapp-bridge
```

The bridge will automatically reconnect using the saved auth state.

## How It Works

1. **Authentication**: When you scan the QR code, Baileys saves authentication credentials to a Docker volume (`nexthello-whatsapp-auth`)
2. **Message Flow**: Incoming WhatsApp messages are forwarded to the Python API at `/bridge/message`
3. **Responses**: The API can return a response that the bridge sends back to WhatsApp
4. **Call Handling**: Incoming calls are automatically rejected with a polite message

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHON_API_URL` | `http://localhost:8001` | URL of the Python API |
| `QR_OUTPUT_DIR` | `/tmp` | Directory to save QR code file |

## Troubleshooting

### QR Code Not Appearing

1. Make sure the container has terminal access:
   ```bash
   docker compose run --rm -it whatsapp-connect
   ```

2. Check the `/tmp/whatsapp-qr.txt` file on your host

### Connection Keeps Dropping

1. Check the logs:
   ```bash
   docker compose logs whatsapp-bridge
   ```

2. Delete auth state and re-authenticate:
   ```bash
   docker volume rm nexthello-whatsapp-auth
   docker compose run --rm whatsapp-connect
   ```

### "Logged Out" Error

WhatsApp may have logged out the device. Re-authenticate:

```bash
docker volume rm nexthello-whatsapp-auth
docker compose run --rm whatsapp-connect
```

## File Structure

```
whatsapp-bridge/
  index.js          # Main bridge code
  package.json      # Node.js dependencies
  Dockerfile        # Container build
  README.md         # This file
```

## Quick Reference

```bash
# Connect WhatsApp (interactive)
docker compose run --rm whatsapp-connect

# View saved QR code
cat /tmp/whatsapp-qr.txt

# Start bridge service
docker compose up -d whatsapp-bridge

# View bridge logs
docker compose logs -f whatsapp-bridge

# Restart bridge
docker compose restart whatsapp-bridge

# Re-authenticate
docker volume rm nexthello-whatsapp-auth
docker compose run --rm whatsapp-connect
```
