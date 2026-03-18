"""Prometheus metrics for LLM usage/cost and moderation outcomes."""

from __future__ import annotations

import logging
import importlib
from typing import Any, Optional

from prometheus_client import Counter, Histogram

logger = logging.getLogger(__name__)


LLM_CALLS_TOTAL = Counter(
    "nexthello_llm_calls_total",
    "Total number of LLM calls",
    ["agent", "operation", "provider", "model", "status"],
)

LLM_CALL_DURATION_SECONDS = Histogram(
    "nexthello_llm_call_duration_seconds",
    "LLM call duration in seconds",
    ["agent", "operation", "provider", "model"],
)

LLM_PROMPT_TOKENS_TOTAL = Counter(
    "nexthello_llm_prompt_tokens_total",
    "Total prompt/input tokens used by LLM calls",
    ["agent", "operation", "provider", "model"],
)

LLM_COMPLETION_TOKENS_TOTAL = Counter(
    "nexthello_llm_completion_tokens_total",
    "Total completion/output tokens used by LLM calls",
    ["agent", "operation", "provider", "model"],
)

LLM_TOTAL_TOKENS_TOTAL = Counter(
    "nexthello_llm_total_tokens_total",
    "Total tokens used by LLM calls",
    ["agent", "operation", "provider", "model"],
)

LLM_COST_USD_TOTAL = Counter(
    "nexthello_llm_cost_usd_total",
    "Estimated total LLM cost in USD",
    ["agent", "operation", "provider", "model", "cost_source"],
)

MODERATION_OUTCOMES_TOTAL = Counter(
    "nexthello_moderation_outcomes_total",
    "Moderation outcomes from group moderator agent",
    ["outcome", "status"],
)


def _provider_from_model(model: str) -> str:
    value = (model or "unknown").strip()
    if "/" in value:
        return value.split("/", 1)[0] or "unknown"
    return "unknown"


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_usage_dict(result: Any) -> dict[str, Any]:
    if result is None:
        return {}

    usage = getattr(result, "token_usage", None)
    if usage is None:
        usage = getattr(result, "usage", None)

    if isinstance(usage, dict):
        return usage

    if usage is not None and hasattr(usage, "__dict__"):
        return dict(usage.__dict__)

    if hasattr(result, "__dict__"):
        candidate = result.__dict__.get("token_usage") or result.__dict__.get("usage")
        if isinstance(candidate, dict):
            return candidate

    return {}


def extract_llm_usage(result: Any) -> dict[str, Optional[float]]:
    usage = _extract_usage_dict(result)
    prompt_tokens = _to_float(
        usage.get("prompt_tokens") or usage.get("input_tokens") or usage.get("promptTokens")
    )
    completion_tokens = _to_float(
        usage.get("completion_tokens")
        or usage.get("output_tokens")
        or usage.get("completionTokens")
    )
    total_tokens = _to_float(
        usage.get("total_tokens")
        or usage.get("totalTokens")
        or (
            (prompt_tokens or 0.0) + (completion_tokens or 0.0)
            if prompt_tokens is not None or completion_tokens is not None
            else None
        )
    )
    total_cost = _to_float(
        usage.get("total_cost")
        or usage.get("cost")
        or usage.get("totalCost")
        or usage.get("estimated_cost")
    )

    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "total_cost": total_cost,
    }


def estimate_cost_with_litellm(
    *,
    model: str,
    prompt_tokens: Optional[float],
    completion_tokens: Optional[float],
) -> Optional[float]:
    if prompt_tokens is None and completion_tokens is None:
        return None

    try:
        litellm = importlib.import_module("litellm")

        prompt_count = int(prompt_tokens or 0)
        completion_count = int(completion_tokens or 0)

        try:
            return float(
                litellm.completion_cost(
                    model=model,
                    prompt_tokens=prompt_count,
                    completion_tokens=completion_count,
                )
            )
        except TypeError:
            # Older LiteLLM versions don't accept token counts on completion_cost().
            prompt_cost, completion_cost = litellm.cost_per_token(
                model=model,
                prompt_tokens=prompt_count,
                completion_tokens=completion_count,
            )
            return float(prompt_cost) + float(completion_cost)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("LLM cost estimation failed: %s", exc)
        return None


def observe_llm_call(
    *,
    agent: str,
    operation: str,
    model: str,
    status: str,
    duration_seconds: float,
    prompt_tokens: Optional[float] = None,
    completion_tokens: Optional[float] = None,
    total_tokens: Optional[float] = None,
    total_cost_usd: Optional[float] = None,
    cost_source: str = "reported",
) -> None:
    provider = _provider_from_model(model)
    model_name = (model or "unknown").strip() or "unknown"

    LLM_CALLS_TOTAL.labels(agent, operation, provider, model_name, status).inc()
    LLM_CALL_DURATION_SECONDS.labels(agent, operation, provider, model_name).observe(
        max(duration_seconds, 0.0)
    )

    if prompt_tokens is not None and prompt_tokens >= 0:
        LLM_PROMPT_TOKENS_TOTAL.labels(agent, operation, provider, model_name).inc(prompt_tokens)
    if completion_tokens is not None and completion_tokens >= 0:
        LLM_COMPLETION_TOKENS_TOTAL.labels(agent, operation, provider, model_name).inc(
            completion_tokens
        )
    if total_tokens is not None and total_tokens >= 0:
        LLM_TOTAL_TOKENS_TOTAL.labels(agent, operation, provider, model_name).inc(total_tokens)
    if total_cost_usd is not None and total_cost_usd >= 0:
        LLM_COST_USD_TOTAL.labels(
            agent, operation, provider, model_name, cost_source or "reported"
        ).inc(total_cost_usd)


def observe_moderation_outcome(*, outcome: str, status: str) -> None:
    MODERATION_OUTCOMES_TOTAL.labels(outcome or "unknown", status or "unknown").inc()
