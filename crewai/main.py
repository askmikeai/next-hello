"""
NextHello CrewAI - Main Entry Point

Run with:
    uv run uvicorn main:app --host 0.0.0.0 --port 8001 --reload

Or:
    python main.py
"""

import uvicorn

from src.api import app

if __name__ == "__main__":
    uvicorn.run(
        "src.api:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
    )
