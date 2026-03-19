"""
WhatsApp Moderation Agent - Moderates admin-managed group chats.

Policy:
- First violation in a group within the configured window: delete + warn
- Second violation in the same group within the window: delete + kick
"""

import json
import logging
import os
import re
from typing import Any, List, Optional

import httpx
from crewai import Agent, Crew, LLM, Task

from ..agent_runner import AutonomousAgent
from ..blackboard import ContactState
from ..events import EventType, SwarmEvent
from ..llm_pool import LLMPool

logger = logging.getLogger(__name__)


class WhatsAppModerationAgent(AutonomousAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._api_base_url = os.getenv("NEXTHELLO_API_URL", "http://api:8001").rstrip("/")
        self._llm: Optional[LLM] = None
        self._fallback_llm: Optional[LLM] = None

    @property
    def name(self) -> str:
        return "whatsapp-moderation"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [EventType.GROUP_MESSAGE_RECEIVED]

    @property
    def requires_lock(self) -> bool:
        return False

    def _owner_headers(self, event: SwarmEvent) -> dict[str, str]:
        owner = event.owner_id or ""
        return {"X-NextHello-User": owner} if owner else {}

    async def _load_llms(self, owner_id: str) -> None:
        cfg = await self.get_owner_config(owner_id)
        llm_cfg = cfg.llm
        anthropic_key = llm_cfg.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY", "")
        openai_key = llm_cfg.get("openai_api_key") or os.getenv("OPENAI_API_KEY", "")
        primary = llm_cfg.get("primary_provider") or "anthropic/claude-sonnet-4-20250514"

        # Use pooled LLM instances
        if primary.startswith("anthropic/") and anthropic_key:
            self._llm = await LLMPool.get(primary, temperature=0, max_tokens=512)
        elif openai_key:
            self._llm = await LLMPool.get(primary, temperature=0)
        else:
            self._llm = None

        # Get pooled fallback LLM
        if openai_key and primary.startswith("anthropic/"):
            self._fallback_llm = await LLMPool.get("openai/gpt-4o-mini", temperature=0)
        elif anthropic_key and not primary.startswith("anthropic/"):
            self._fallback_llm = await LLMPool.get(
                "anthropic/claude-sonnet-4-20250514", temperature=0, max_tokens=512
            )
        else:
            self._fallback_llm = None

    async def should_act(self, event: SwarmEvent, contact: ContactState) -> bool:
        if event.event_type != EventType.GROUP_MESSAGE_RECEIVED:
            return False

        cfg = await self.get_owner_config(event.owner_id)
        behavior = self._behavior_for_group(
            cfg.behavior if cfg else {}, event.payload.get("group_jid")
        )
        if not bool(behavior.get("moderation_mode", False)):
            return False

        if not bool(event.payload.get("group_jid")):
            return False

        if not bool(event.payload.get("participant_jid")):
            return False

        if not bool(event.payload.get("bot_is_group_admin", False)):
            return False

        return bool(str(event.payload.get("text") or "").strip())

    async def execute(self, event: SwarmEvent, contact: ContactState) -> List[SwarmEvent]:
        cfg = await self.get_owner_config(event.owner_id)
        behavior = self._behavior_for_group(
            cfg.behavior if cfg else {}, event.payload.get("group_jid")
        )

        group_jid = str(event.payload.get("group_jid") or "").strip()
        participant_jid = str(event.payload.get("participant_jid") or "").strip()
        message_id = str(event.payload.get("message_id") or "").strip()
        message_text = str(event.payload.get("text") or "").strip()
        group_subject = str(event.payload.get("group_subject") or group_jid).strip()
        guidelines = str(behavior.get("moderation_guidelines") or "").strip()

        if not guidelines:
            return []

        classification = await self._classify_message(
            owner_id=event.owner_id,
            group_subject=group_subject,
            message_text=message_text,
            guidelines=guidelines,
        )
        if not classification.get("violation"):
            return []

        reason = str(
            classification.get("reason") or "Violation matched moderation guidelines"
        ).strip()
        matched_guideline = str(classification.get("matched_guideline") or "").strip()
        window_hours = max(int(behavior.get("moderation_window_hours") or 48), 1)

        prior_violations = await self._count_recent_violations(
            owner_id=event.owner_id,
            group_jid=group_jid,
            participant_jid=participant_jid,
            window_hours=window_hours,
        )

        await self._record_violation(
            owner_id=event.owner_id,
            group_jid=group_jid,
            participant_jid=participant_jid,
            message_id=message_id,
            message_content=message_text,
            matched_guideline=matched_guideline,
            reason=reason,
        )

        delete_result = await self._delete_group_message(
            event, group_jid, participant_jid, message_id
        )
        await self._record_action(
            owner_id=event.owner_id,
            group_jid=group_jid,
            participant_jid=participant_jid,
            message_id=message_id,
            action_type="delete",
            status="completed" if delete_result else "failed",
            details={"reason": reason},
        )

        if prior_violations >= 1:
            kick_result = await self._remove_group_member(event, group_jid, participant_jid)
            await self._record_action(
                owner_id=event.owner_id,
                group_jid=group_jid,
                participant_jid=participant_jid,
                message_id=message_id,
                action_type="kick",
                status="completed" if kick_result else "failed",
                details={"reason": reason, "matched_guideline": matched_guideline},
            )
            action_taken = "kick"
        else:
            warning_text = self._render_warning_text(
                template=str(behavior.get("moderation_warning_template") or "").strip(),
                participant_jid=participant_jid,
                reason=reason,
                matched_guideline=matched_guideline,
                group_subject=group_subject,
                window_hours=window_hours,
            )
            warn_result = await self._warn_group_member(
                event, group_jid, participant_jid, warning_text
            )
            await self._record_action(
                owner_id=event.owner_id,
                group_jid=group_jid,
                participant_jid=participant_jid,
                message_id=message_id,
                action_type="warn",
                status="completed" if warn_result else "failed",
                details={"reason": reason, "warning_text": warning_text},
            )
            action_taken = "warn"

        return [
            event.create_response(
                event_type=EventType.GROUP_MODERATION_ACTIONED,
                payload={
                    "group_jid": group_jid,
                    "participant_jid": participant_jid,
                    "message_id": message_id,
                    "action": action_taken,
                    "reason": reason,
                    "matched_guideline": matched_guideline,
                },
                source_agent=self.name,
            )
        ]

    def _behavior_for_group(
        self, behavior: dict[str, Any], group_jid: Optional[str]
    ) -> dict[str, Any]:
        merged = dict(behavior or {})
        overrides = merged.get("moderation_group_overrides") or {}
        group_override = overrides.get(str(group_jid or "")) or {}
        if isinstance(group_override, dict):
            merged.update(group_override)
        return merged

    async def _classify_message(
        self,
        *,
        owner_id: str,
        group_subject: str,
        message_text: str,
        guidelines: str,
    ) -> dict[str, Any]:
        await self._load_llms(owner_id)
        fallback = {"violation": False, "reason": "", "matched_guideline": ""}

        prompt = f"""
Review this WhatsApp group message against the moderation guidelines.
Return only compact JSON with keys: violation, reason, matched_guideline.

Group: {group_subject}
Guidelines:
{guidelines}

Message:
{message_text}
""".strip()

        if not self._llm:
            return fallback

        agent = Agent(
            role="WhatsApp Group Moderator",
            goal="Classify whether a group message violates moderation guidelines",
            backstory=(
                "You are a strict but fair moderator. You only flag clear violations of the provided "
                "guidelines and return machine-readable JSON."
            ),
            llm=self._llm,
            verbose=False,
        )
        task = Task(
            description=prompt,
            expected_output='JSON: {"violation": true|false, "reason": "...", "matched_guideline": "..."}',
            agent=agent,
        )

        crews = [(agent, task, self._llm)]
        if self._fallback_llm:
            fallback_agent = Agent(
                role=agent.role,
                goal=agent.goal,
                backstory=agent.backstory,
                llm=self._fallback_llm,
                verbose=False,
            )
            fallback_task = Task(
                description=prompt,
                expected_output=task.expected_output,
                agent=fallback_agent,
            )
            crews.append((fallback_agent, fallback_task, self._fallback_llm))

        for current_agent, current_task, _llm in crews:
            try:
                result = Crew(agents=[current_agent], tasks=[current_task], verbose=False).kickoff()
                parsed = self._parse_json_payload(str(result))
                if parsed is not None:
                    return {
                        "violation": bool(parsed.get("violation", False)),
                        "reason": str(parsed.get("reason") or "").strip(),
                        "matched_guideline": str(parsed.get("matched_guideline") or "").strip(),
                    }
            except Exception as exc:
                logger.warning("[whatsapp-moderation] LLM classification failed: %s", exc)

        return fallback

    def _parse_json_payload(self, text: str) -> Optional[dict[str, Any]]:
        candidate = (text or "").strip()
        if not candidate:
            return None

        try:
            return json.loads(candidate)
        except Exception:
            match = re.search(r"\{.*\}", candidate, re.DOTALL)
            if not match:
                return None
            try:
                return json.loads(match.group(0))
            except Exception:
                return None

    async def _count_recent_violations(
        self,
        *,
        owner_id: str,
        group_jid: str,
        participant_jid: str,
        window_hours: int,
    ) -> int:
        if not self.blackboard or not self.blackboard._pool:
            return 0

        async with self.blackboard._pool.acquire() as conn:
            value = await conn.fetchval(
                """
                SELECT COUNT(*)
                FROM whatsapp_group_moderation_violations
                WHERE owner_id = $1
                  AND group_jid = $2
                  AND participant_jid = $3
                  AND created_at >= NOW() - ($4::text || ' hours')::interval
                """,
                owner_id,
                group_jid,
                participant_jid,
                window_hours,
            )
        return int(value or 0)

    async def _record_violation(self, **kwargs) -> None:
        if not self.blackboard or not self.blackboard._pool:
            return

        participant_phone = self._participant_phone(kwargs.get("participant_jid"))
        async with self.blackboard._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO whatsapp_group_moderation_violations (
                    owner_id, group_jid, participant_jid, participant_phone_number,
                    message_id, message_content, matched_guideline, reason
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                kwargs["owner_id"],
                kwargs["group_jid"],
                kwargs["participant_jid"],
                participant_phone,
                kwargs["message_id"],
                kwargs.get("message_content") or "",
                kwargs.get("matched_guideline") or "",
                kwargs.get("reason") or "",
            )

    async def _record_action(self, **kwargs) -> None:
        if not self.blackboard or not self.blackboard._pool:
            return

        participant_phone = self._participant_phone(kwargs.get("participant_jid"))
        async with self.blackboard._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO whatsapp_group_moderation_actions (
                    owner_id, group_jid, participant_jid, participant_phone_number,
                    message_id, action_type, status, details
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                """,
                kwargs["owner_id"],
                kwargs["group_jid"],
                kwargs.get("participant_jid"),
                participant_phone,
                kwargs.get("message_id"),
                kwargs["action_type"],
                kwargs["status"],
                json.dumps(kwargs.get("details") or {}),
            )

    async def _delete_group_message(
        self, event: SwarmEvent, group_jid: str, participant_jid: str, message_id: str
    ) -> bool:
        return await self._post_action(
            event,
            "/admin/api/whatsapp/group/delete",
            {"group_jid": group_jid, "participant_jid": participant_jid, "message_id": message_id},
        )

    async def _warn_group_member(
        self, event: SwarmEvent, group_jid: str, participant_jid: str, warning_text: str
    ) -> bool:
        return await self._post_action(
            event,
            "/admin/api/whatsapp/group/warn",
            {
                "group_jid": group_jid,
                "participant_jid": participant_jid,
                "warning_text": warning_text,
            },
        )

    async def _remove_group_member(
        self, event: SwarmEvent, group_jid: str, participant_jid: str
    ) -> bool:
        return await self._post_action(
            event,
            "/admin/api/whatsapp/group/remove",
            {"group_jid": group_jid, "participant_jid": participant_jid},
        )

    async def _post_action(self, event: SwarmEvent, path: str, payload: dict[str, Any]) -> bool:
        url = f"{self._api_base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(url, json=payload, headers=self._owner_headers(event))
            return response.status_code == 200
        except Exception as exc:
            logger.warning("[whatsapp-moderation] Action call failed %s: %s", path, exc)
            return False

    def _participant_phone(self, participant_jid: Optional[str]) -> Optional[str]:
        digits = "".join(ch for ch in str(participant_jid or "").split("@")[0] if ch.isdigit())
        return digits or None

    def _participant_mention(self, participant_jid: str) -> str:
        return self._participant_phone(participant_jid) or participant_jid.split("@")[0] or "member"

    def _render_warning_text(
        self,
        *,
        template: str,
        participant_jid: str,
        reason: str,
        matched_guideline: str,
        group_subject: str,
        window_hours: int,
    ) -> str:
        warning_template = template or (
            "@{member} your message violated the group guidelines and was removed. "
            "Another violation within {window_hours} hours will result in removal from the group."
        )
        return warning_template.format(
            member=self._participant_mention(participant_jid),
            reason=reason,
            guideline=matched_guideline,
            group_subject=group_subject,
            window_hours=window_hours,
        )
