#!/usr/bin/env bash

set -euo pipefail

: "${OPENCLAW_BASE_URL:=http://100.92.52.64:18789}"
: "${OPENCLAW_GATEWAY_TOKEN:=d3aa1b8e979c5867b8c14abede9110c88dea7f384ffcd7c9}"
: "${OPENCLAW_HOOKS_TOKEN:=383a695987fabf8e9efef45a5066be182f02cc95ef079156}"
: "${OPENCLAW_TIMEOUT_SECONDS:=120}"

_openclaw_effective_base_url() {
  if [[ "${OPENCLAW_USE_HOST_FALLBACK:-0}" == "1" ]]; then
    printf '%s' "http://host.docker.internal:18789"
    return
  fi
  printf '%s' "${OPENCLAW_BASE_URL}"
}

openclaw_post_responses() {
  local base_url
  base_url="$(_openclaw_effective_base_url)"
  curl --silent --show-error --fail \
    --max-time "${OPENCLAW_TIMEOUT_SECONDS}" \
    -X POST "${base_url}/v1/responses" \
    -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"model":"openclaw:main","input":"Return only minified JSON: {\"ok\":true,\"task\":\"research\"}"}'
}

openclaw_post_hook_agent() {
  local base_url
  base_url="$(_openclaw_effective_base_url)"
  curl --silent --show-error --fail \
    --max-time "${OPENCLAW_TIMEOUT_SECONDS}" \
    -X POST "${base_url}/hooks/agent" \
    -H "Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"message":"Summarize latest async job status as JSON.","name":"docker-job","deliver":false,"wakeMode":"next-heartbeat"}'
}
