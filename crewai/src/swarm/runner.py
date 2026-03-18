"""
Swarm Runner - Startup and lifecycle management

Initializes and runs all swarm agents.
Can be run as a standalone service or integrated with the API.

Usage:
    python -m src.swarm.runner
"""

import os
import asyncio
import signal
import logging
from typing import Optional

from .eventbus import EventBus
from .blackboard import Blackboard
from .agent_runner import AgentPool
from .agents import (
    ResearchAgent,
    QualificationAgent,
    PersonalizationAgent,
    MessagingAgent,
    WhatsAppCleanupAgent,
    WhatsAppModerationAgent,
    VideoAgent,
    VoiceAgent,
    CRMAgent,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Miami Vice colors (ANSI escape codes)
PINK = "\033[38;2;255;110;199m"
CYAN = "\033[38;2;0;255;255m"
ORANGE = "\033[38;2;255;107;53m"
YELLOW = "\033[38;2;255;217;61m"
RESET = "\033[0m"


def print_banner() -> None:
    """Print the NextHello CLI banner with Miami Vice colors"""
    print()
    print(
        f"{PINK}  _   _           _   _   _      _ _        {CYAN}⣿⣿⣿⣿⣿⣿⣿⣿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿{RESET}"
    )
    print(
        f"{PINK} | \\ | | _____  _| |_| | | | ___| | | ___   {CYAN}⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠙⠿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿{RESET}"
    )
    print(
        f"{PINK} |  \\| |/ _ \\ \\/ / __| |_| |/ _ \\ | |/ _ \\  {CYAN}⣿⣿⣿⣿⣿⣿⡀⠀⣠⣴⣶⣿⣿⣿⣿⣶⣮⣝⠻⢿⣿⣿⣿⣿⣿{RESET}"
    )
    print(
        f"{PINK} | |\\  |  __/>  <| |_|  _  |  __/ | | (_) | {CYAN}⣿⣿⣿⣿⣿⡟⣡⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠙⢿{RESET}"
    )
    print(
        f"{PINK} |_| \\_|\\___/_/\\_\\\\__|_| |_|\\___|_|_|\\___/  {CYAN}⣿⠿⣿⣿⡿⢰⣿⡿⠋⠉⠉⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⣸{RESET}"
    )
    print(f"                                            {CYAN}⠁⠀⠀⠙⠃⢿⣿⡅⠀⠀⢀⣼⣿⣿⣿⣿⠟⠛⠻⣿⣿⣷⢀⣴⣿{RESET}")
    print(
        f"{ORANGE}  NextHello{RESET}                                 {CYAN}⡀⠀⠀⠀⠀⠸⣿⣛⣳⣾⣿⢿⡍⢉⣻⡇⠰⠀⠀⣿⣿⣿⢸⣿⣿{RESET}"
    )
    print(
        f"{CYAN}  AI Networking Swarm{RESET}                       {CYAN}⣷⡀⠀⠀⠀⠀⠈⠻⢿⣿⣿⣷⣶⣬⣽⣿⣦⣤⣤⣟⣿⢇⣾⣿⣿{RESET}"
    )
    print(
        f"    {YELLOW}🌴{RESET} {PINK}Made in Miami{RESET}                         {CYAN}⣿⣿⣄⠀⠀⠀⠀⠀⠀⠈⠙⠻⠿⣿⣿⣿⣿⣮⣿⠟⣡⣾⣿⣿⣿{RESET}"
    )
    print(f"                                            {CYAN}⣿⣿⣿⡇⢰⣶⣤⣤⣤⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿{RESET}")
    print()


class SwarmRunner:
    """
    Main swarm runner that manages all autonomous agents.

    Features:
    - Initializes all infrastructure (Redis, PostgreSQL)
    - Creates and starts all agents
    - Handles graceful shutdown
    - Provides health monitoring
    """

    def __init__(
        self,
        redis_url: Optional[str] = None,
        database_url: Optional[str] = None,
    ):
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
        self.database_url = database_url or os.getenv("DATABASE_URL")

        self.eventbus: Optional[EventBus] = None
        self.blackboard: Optional[Blackboard] = None
        self.agent_pool: Optional[AgentPool] = None
        self._running = False

    async def initialize(self) -> None:
        """Initialize all components"""
        logger.info("Initializing swarm...")

        # Create event bus
        self.eventbus = EventBus(redis_url=self.redis_url)
        await self.eventbus.connect()

        # Create blackboard
        self.blackboard = Blackboard(
            redis_url=self.redis_url,
            database_url=self.database_url,
        )
        await self.blackboard.connect()

        # Create agent pool
        self.agent_pool = AgentPool(
            eventbus=self.eventbus,
            blackboard=self.blackboard,
        )

        # Add all agents
        self.agent_pool.add_agent(ResearchAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(QualificationAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(PersonalizationAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(MessagingAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(WhatsAppCleanupAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(WhatsAppModerationAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(VideoAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(VoiceAgent(self.eventbus, self.blackboard))
        self.agent_pool.add_agent(CRMAgent(self.eventbus, self.blackboard))

        logger.info(f"Initialized {len(self.agent_pool.agents)} agents")

    async def start(self) -> None:
        """Start all agents"""
        if not self.agent_pool:
            await self.initialize()

        self._running = True
        await self.agent_pool.start_all()
        logger.info("Swarm started")

    async def stop(self) -> None:
        """Stop all agents and cleanup"""
        self._running = False

        if self.agent_pool:
            await self.agent_pool.stop_all()

        if self.eventbus:
            await self.eventbus.close()

        if self.blackboard:
            await self.blackboard.close()

        logger.info("Swarm stopped")

    async def run(self) -> None:
        """Run the swarm until stopped"""
        await self.start()

        try:
            while self._running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            await self.stop()

    def get_agent(self, name: str):
        """Get an agent by name"""
        if self.agent_pool:
            return self.agent_pool.get_agent(name)
        return None

    @property
    def is_running(self) -> bool:
        return self._running


async def run_swarm():
    """Main entry point for running the swarm"""
    print_banner()

    runner = SwarmRunner()

    # Setup signal handlers
    loop = asyncio.get_event_loop()
    shutdown_event = asyncio.Event()

    def handle_signal():
        logger.info("Shutdown signal received")
        shutdown_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_signal)

    # Start the swarm
    await runner.initialize()
    await runner.start()

    # Wait for shutdown signal
    await shutdown_event.wait()

    # Graceful shutdown
    await runner.stop()


def main():
    """CLI entry point"""
    asyncio.run(run_swarm())


if __name__ == "__main__":
    main()
