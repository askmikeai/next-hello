# WhatsApp Connector (Baileys)

This service connects WhatsApp to the Python API using `@whiskeysockets/baileys`.

## Quick Start

```bash
docker compose build whatsapp-connect
docker compose run --rm whatsapp-connect
```

Scan the QR code from your terminal. After auth succeeds, start the background service:

```bash
docker compose up -d whatsapp
```

## Message Flow

- Incoming WhatsApp messages are forwarded to `POST /whatsapp/message` on the Python API.
- If the API returns a `response`, this connector sends it back to the same chat.

## Session Persistence

- Local auth state is stored in `./auth_state/session`.
- If `DATABASE_URL` is set, auth state is also backed up to PostgreSQL via `pg-store.js`.
- On startup, the connector attempts PostgreSQL restore first and only falls back to local/QR if needed.

## Local Endpoints

- `GET /health`
- `GET /qr`
- `POST /send`
- `POST /send-voice`
- `POST /session/backup`
- `POST /session/restore`
- `GET /session/status`
