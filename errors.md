# Debugging Error Log

Last updated: 2026-03-08

## Open Errors

- `nexthello-swarm`: Agent event logging fails with datetime type mismatch (`invalid input for query argument $8 ... expected datetime, got 'str'`).
- `nexthello-swarm`: `agent_activity_log` inserts fail with constraint violation (`agent_activity_log_agent_type_check`).
- `nexthello-swarm`: LLM fallback triggered because Ollama model is missing (`model 'llama4' not found`).
- `./nexthello status`: Status command reports false negative because `pgrep` is missing in the API container.
- `whatsapp-bridge`: Audio messages are forwarded with empty content (`extractMessageDetails` returns `{ type: 'audio', content: '' }`), so there is no transcription before swarm processing.
- `/voice/generate`: Synchronous voice generation currently fails with `error: "'first_name'"` for test payloads.

## Resolved During Debugging

- Docker startup failed with `no space left on device` while recreating containers.
  - Action: Pruned orphan images and builder cache.
  - Result: Services started successfully.

- Swarm appeared unresponsive because legacy standalone agent containers were also consuming Redis stream events.
  - Action: Stopped `nexthello-agent-*` containers that conflicted with `nexthello-swarm`.
  - Result: Message flow resumed (`message.received -> message.send -> message.sent`).

- Grafana Loki datasource was not auto-provisioned in the running Grafana instance.
  - Cause: Grafana container was mounted from a different project path.
  - Action: Manual datasource setup with URL `http://loki:3100`.
  - Result: Loki queries working in Grafana Explore.
