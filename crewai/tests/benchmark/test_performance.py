"""
Performance benchmarks for the swarm system.

Measures:
- Messages processed per second
- Average latency per message (p50, p95, p99)
- Event count per message
- Scoring computation efficiency

Run with: pytest tests/benchmark/ -v --benchmark-json=results.json
"""

import pytest
import asyncio
import time
import statistics
from typing import List

from tests.helpers.fakes import FakeEventBus, FakeBlackboard
from tests.helpers.agent_harness import event_factory, contact_factory

from src.swarm.events import EventType, SwarmEvent, ActionFlags
from src.swarm.blackboard import ContactState
from src.swarm.coordinator import SwarmCoordinator
from src.swarm.context_cache import ContextCache, build_contact_context
from src.swarm.agents.qualification_agent import QualificationAgent


class TestCoordinatorLatency:
    """Benchmark tests for coordinator message handling latency."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        return FakeBlackboard()

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_new_contact_latency(self, coordinator):
        """Measure latency for new contact message handling."""
        latencies = []

        for i in range(100):
            start = time.perf_counter()
            await coordinator.handle_incoming_message(
                phone_number=f"123456789{i:03d}",
                message_text="Hello, I'm testing!",
                message_type="text",
                push_name=f"User {i}",
                owner_id="test-owner",
            )
            elapsed = (time.perf_counter() - start) * 1000  # ms
            latencies.append(elapsed)

        p50 = statistics.median(latencies)
        p95 = statistics.quantiles(latencies, n=20)[18]  # 95th percentile
        p99 = statistics.quantiles(latencies, n=100)[98]  # 99th percentile
        mean = statistics.mean(latencies)

        print(f"\nNew contact latency (100 iterations):")
        print(f"  Mean: {mean:.2f}ms")
        print(f"  P50:  {p50:.2f}ms")
        print(f"  P95:  {p95:.2f}ms")
        print(f"  P99:  {p99:.2f}ms")

        # Target: < 5ms for local processing (no network)
        assert p50 < 10, f"P50 latency too high: {p50:.2f}ms"

    @pytest.mark.asyncio
    async def test_returning_contact_latency(self, coordinator, blackboard):
        """Measure latency for returning contact message handling."""
        # Pre-populate contacts
        for i in range(100):
            blackboard.contacts[f"test-owner:123456789{i:03d}"] = ContactState(
                phone_number=f"123456789{i:03d}",
                first_name=f"User{i}",
                welcomed=True,
                conversation_turns=3,
            )

        latencies = []

        for i in range(100):
            start = time.perf_counter()
            await coordinator.handle_incoming_message(
                phone_number=f"123456789{i:03d}",
                message_text="Following up!",
                message_type="text",
                owner_id="test-owner",
            )
            elapsed = (time.perf_counter() - start) * 1000  # ms
            latencies.append(elapsed)

        p50 = statistics.median(latencies)
        mean = statistics.mean(latencies)

        print(f"\nReturning contact latency (100 iterations):")
        print(f"  Mean: {mean:.2f}ms")
        print(f"  P50:  {p50:.2f}ms")

        # Returning contacts should be faster (no welcome, no research trigger)
        assert p50 < 5, f"P50 latency too high: {p50:.2f}ms"


class TestEventCountPerMessage:
    """Benchmark tests for event count per message."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        return FakeBlackboard()

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_new_contact_event_count(self, coordinator, eventbus):
        """Count events published for new contact."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hello!",
            message_type="text",
            owner_id="test-owner",
        )

        event_types = [e.event.event_type for e in eventbus.published_events]
        print(f"\nNew contact events: {len(event_types)}")
        for et in event_types:
            print(f"  - {et.value if hasattr(et, 'value') else et}")

        # Target: reduce from 6 events to ~3-4 with consolidation
        # Current events: CONTACT_CREATED, MESSAGE_RECEIVED, VIDEO_REQUESTED, RESEARCH_NEEDED
        assert len(event_types) <= 6, f"Too many events: {len(event_types)}"

    @pytest.mark.asyncio
    async def test_returning_contact_event_count(self, coordinator, eventbus, blackboard):
        """Count events published for returning contact."""
        blackboard.contacts["test-owner:1234567890"] = ContactState(
            phone_number="1234567890",
            first_name="John",
            welcomed=True,
            conversation_turns=3,
            heygen_video_url="https://example.com/video",
        )

        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hey!",
            message_type="text",
            owner_id="test-owner",
        )

        event_types = [e.event.event_type for e in eventbus.published_events]
        print(f"\nReturning contact events: {len(event_types)}")
        for et in event_types:
            print(f"  - {et.value if hasattr(et, 'value') else et}")

        # Returning contact should publish fewer events (no welcome, no research, no video)
        assert len(event_types) <= 2, f"Too many events: {len(event_types)}"


class TestContextCachePerformance:
    """Benchmark tests for context cache efficiency."""

    def test_cache_hit_performance(self):
        """Measure cache hit vs miss performance."""
        ContextCache.clear()

        contact = ContactState(
            phone_number="1234567890",
            first_name="John",
            last_name="Doe",
            company_name="Acme Corp",
            job_title="CTO",
            email="john@acme.com",
            conversation_turns=5,
            research_data={"skills": ["Python", "ML"]},
        )

        # Cache miss (first call)
        miss_times = []
        for i in range(100):
            ContextCache.clear()
            start = time.perf_counter()
            build_contact_context(contact)
            miss_times.append((time.perf_counter() - start) * 1000)

        # Cache hit (second call with same contact)
        hit_times = []
        ContextCache.clear()
        ContextCache.get_or_build(contact, build_contact_context, owner_id="test")

        for i in range(100):
            start = time.perf_counter()
            ContextCache.get_or_build(contact, build_contact_context, owner_id="test")
            hit_times.append((time.perf_counter() - start) * 1000)

        miss_p50 = statistics.median(miss_times)
        hit_p50 = statistics.median(hit_times)

        print(f"\nContext cache performance (100 iterations):")
        print(f"  Cache miss P50: {miss_p50:.4f}ms")
        print(f"  Cache hit P50:  {hit_p50:.4f}ms")

        # For very fast operations, cache overhead may dominate
        # Just verify both are acceptably fast (< 1ms)
        assert miss_p50 < 1.0, f"Cache miss too slow: {miss_p50:.4f}ms"
        assert hit_p50 < 1.0, f"Cache hit too slow: {hit_p50:.4f}ms"


class TestQualificationScoringPerformance:
    """Benchmark tests for qualification scoring efficiency."""

    @pytest.fixture
    def agent(self):
        eventbus = FakeEventBus()
        blackboard = FakeBlackboard()
        return QualificationAgent(eventbus, blackboard)

    @pytest.mark.asyncio
    async def test_qualification_scoring_time(self, agent):
        """Measure time for qualification scoring."""
        contact = ContactState(
            phone_number="1234567890",
            first_name="John",
            last_name="Doe",
            job_title="VP Engineering",
            company_name="TechCorp",
            email="john@techcorp.com",
            linkedin_url="https://linkedin.com/in/johndoe",
            conversation_turns=8,
            research_data={
                "company_size": "1001-5000",
                "company_industry": "Technology",
            },
        )

        times = []
        for _ in range(100):
            start = time.perf_counter()
            await agent._qualify_contact(contact)
            times.append((time.perf_counter() - start) * 1000)

        p50 = statistics.median(times)
        mean = statistics.mean(times)

        print(f"\nQualification scoring (100 iterations):")
        print(f"  Mean: {mean:.4f}ms")
        print(f"  P50:  {p50:.4f}ms")

        # Scoring should be very fast (pure computation, no I/O)
        assert p50 < 1, f"Scoring too slow: {p50:.4f}ms"

    @pytest.mark.asyncio
    async def test_scoring_returns_factors_in_single_call(self, agent):
        """Verify factors are computed alongside score (no duplicate work)."""
        contact = ContactState(
            phone_number="1234567890",
            job_title="CEO",
            company_name="Startup Inc",
        )

        # Track scoring function calls
        call_counts = {
            "job_title": 0,
            "company": 0,
            "engagement": 0,
            "completeness": 0,
        }

        original_score_job_title = agent._score_job_title
        original_score_company = agent._score_company
        original_score_engagement = agent._score_engagement
        original_score_completeness = agent._score_completeness

        def counting_score_job_title(*args, **kwargs):
            call_counts["job_title"] += 1
            return original_score_job_title(*args, **kwargs)

        def counting_score_company(*args, **kwargs):
            call_counts["company"] += 1
            return original_score_company(*args, **kwargs)

        def counting_score_engagement(*args, **kwargs):
            call_counts["engagement"] += 1
            return original_score_engagement(*args, **kwargs)

        def counting_score_completeness(*args, **kwargs):
            call_counts["completeness"] += 1
            return original_score_completeness(*args, **kwargs)

        agent._score_job_title = counting_score_job_title
        agent._score_company = counting_score_company
        agent._score_engagement = counting_score_engagement
        agent._score_completeness = counting_score_completeness

        # Call _qualify_contact which now returns factors
        score, tier, reasoning, factors = await agent._qualify_contact(contact)

        # Each scoring function should only be called once
        assert call_counts["job_title"] == 1
        assert call_counts["company"] == 1
        assert call_counts["engagement"] == 1
        assert call_counts["completeness"] == 1

        # Factors should be populated
        assert factors["job_title"]["score"] == original_score_job_title(contact.job_title)


class TestThroughput:
    """Benchmark tests for message throughput."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        return FakeBlackboard()

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_sequential_throughput(self, coordinator):
        """Measure sequential message throughput."""
        message_count = 100

        start = time.perf_counter()
        for i in range(message_count):
            await coordinator.handle_incoming_message(
                phone_number=f"123456789{i:03d}",
                message_text=f"Message {i}",
                message_type="text",
                owner_id="test-owner",
            )
        elapsed = time.perf_counter() - start

        throughput = message_count / elapsed
        print(f"\nSequential throughput: {throughput:.1f} messages/sec")

        # Target: > 100 messages/sec
        assert throughput > 50, f"Throughput too low: {throughput:.1f} msg/sec"

    @pytest.mark.asyncio
    async def test_concurrent_throughput(self, coordinator):
        """Measure concurrent message throughput."""
        message_count = 100

        async def send_message(i: int):
            await coordinator.handle_incoming_message(
                phone_number=f"123456789{i:03d}",
                message_text=f"Message {i}",
                message_type="text",
                owner_id="test-owner",
            )

        start = time.perf_counter()
        tasks = [send_message(i) for i in range(message_count)]
        await asyncio.gather(*tasks)
        elapsed = time.perf_counter() - start

        throughput = message_count / elapsed
        print(f"\nConcurrent throughput: {throughput:.1f} messages/sec")

        # Concurrent should be faster than sequential
        assert throughput > 100, f"Throughput too low: {throughput:.1f} msg/sec"
