"""
Web Search Tools for CrewAI

Two-tier search strategy:
1. Serper (Google Search) - Primary, cheaper option ($0.001/search)
2. Perplexity AI - Fallback for complex queries that need synthesis ($0.001/request for small model)

Usage:
    # Primary tool (tries Serper first, falls back to Perplexity)
    result = web_search("What does Company X do?")

    # Direct Perplexity (for complex research)
    result = perplexity_search("Synthesize information about AI trends in 2024")
"""

import os
from typing import Optional

import httpx
from crewai.tools import tool


# =============================================================================
# Serper (Google Search) - Primary Tool
# =============================================================================

@tool("Google Search")
def serper_search(
    query: str,
    num_results: int = 5,
) -> str:
    """
    Search Google using Serper API. Fast and cost-effective for factual lookups.

    Args:
        query: Search query string
        num_results: Number of results to return (default: 5, max: 10)

    Returns:
        Search results with titles, snippets, and links.
    """
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key:
        return "Error: SERPER_API_KEY environment variable not set"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                "https://google.serper.dev/search",
                headers={
                    "X-API-KEY": api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "q": query,
                    "num": min(num_results, 10),
                },
            )

            if response.status_code != 200:
                return f"Serper API error: {response.status_code} - {response.text}"

            data = response.json()

            # Format results
            results = []

            # Answer box (if available)
            if "answerBox" in data:
                answer = data["answerBox"]
                if "answer" in answer:
                    results.append(f"**Quick Answer:** {answer['answer']}")
                elif "snippet" in answer:
                    results.append(f"**Quick Answer:** {answer['snippet']}")

            # Knowledge graph (if available)
            if "knowledgeGraph" in data:
                kg = data["knowledgeGraph"]
                results.append(f"\n**{kg.get('title', 'Info')}:** {kg.get('description', '')}")

            # Organic results
            organic = data.get("organic", [])
            if organic:
                results.append("\n**Search Results:**")
                for i, item in enumerate(organic[:num_results], 1):
                    title = item.get("title", "")
                    snippet = item.get("snippet", "")
                    link = item.get("link", "")
                    results.append(f"{i}. **{title}**\n   {snippet}\n   URL: {link}")

            if not results:
                return f"No results found for: {query}"

            return "\n\n".join(results)

    except httpx.TimeoutException:
        return "Error: Serper API request timed out"
    except Exception as e:
        return f"Error searching: {str(e)}"


# =============================================================================
# Perplexity AI - Fallback for Complex Queries
# =============================================================================

@tool("Perplexity Search")
def perplexity_search(
    query: str,
    model: str = "sonar",
) -> str:
    """
    Search and synthesize information using Perplexity AI.

    Use this for complex queries that need:
    - Information synthesis across multiple sources
    - Recent/current information (uses live web search)
    - Nuanced answers that require reasoning

    Args:
        query: The question or research topic
        model: Perplexity model to use:
            - "sonar" (faster, cheaper - default)
            - "sonar-pro" (better quality, more citations)

    Returns:
        Synthesized answer with source citations.
    """
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        return "Error: PERPLEXITY_API_KEY environment variable not set"

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a helpful research assistant. Provide accurate, well-sourced information. Be concise but thorough."
                        },
                        {
                            "role": "user",
                            "content": query
                        }
                    ],
                    "temperature": 0.2,
                    "max_tokens": 1024,
                },
            )

            if response.status_code != 200:
                return f"Perplexity API error: {response.status_code} - {response.text}"

            data = response.json()

            # Extract the response content
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not content:
                return f"No response from Perplexity for: {query}"

            # Add citations if available
            citations = data.get("citations", [])
            if citations:
                content += "\n\n**Sources:**"
                for i, citation in enumerate(citations[:5], 1):
                    content += f"\n{i}. {citation}"

            return content

    except httpx.TimeoutException:
        return "Error: Perplexity API request timed out"
    except Exception as e:
        return f"Error with Perplexity search: {str(e)}"


# =============================================================================
# Smart Search - Tries Serper First, Falls Back to Perplexity
# =============================================================================

@tool("Web Search")
def web_search(
    query: str,
    require_synthesis: bool = False,
) -> str:
    """
    Smart web search that uses the most appropriate tool.

    Strategy:
    1. If require_synthesis=False: Try Serper (Google) first
    2. If Serper fails or require_synthesis=True: Use Perplexity

    Args:
        query: Search query or research question
        require_synthesis: If True, skip Serper and go straight to Perplexity
                          for complex queries needing synthesis

    Returns:
        Search results or synthesized answer.
    """
    # For complex queries, go straight to Perplexity
    if require_synthesis:
        return perplexity_search.func(query)

    # Try Serper first
    serper_key = os.getenv("SERPER_API_KEY")
    if serper_key:
        result = serper_search.func(query)

        # Check if Serper succeeded
        if not result.startswith("Error:") and "No results found" not in result:
            return result

    # Fallback to Perplexity
    perplexity_key = os.getenv("PERPLEXITY_API_KEY")
    if perplexity_key:
        return perplexity_search.func(query)

    return "Error: No search API keys configured. Set SERPER_API_KEY or PERPLEXITY_API_KEY"


# =============================================================================
# Research Tool - For Deep Research Tasks
# =============================================================================

@tool("Deep Research")
def deep_research(
    topic: str,
    aspects: Optional[str] = None,
) -> str:
    """
    Perform deep research on a topic using Perplexity's large model.

    Use this for comprehensive research that requires:
    - Multiple aspects of a topic
    - Comparative analysis
    - Historical context
    - Expert-level understanding

    Args:
        topic: The main topic to research
        aspects: Specific aspects to focus on (comma-separated)
                 e.g., "company history, leadership, products, competitors"

    Returns:
        Comprehensive research report.
    """
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        return "Error: PERPLEXITY_API_KEY environment variable not set"

    # Build a structured research prompt
    prompt = f"Research the following topic thoroughly: {topic}"
    if aspects:
        prompt += f"\n\nFocus on these specific aspects:\n{aspects}"
    prompt += "\n\nProvide a well-structured response with clear sections."

    try:
        with httpx.Client(timeout=90.0) as client:
            response = client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "sonar-pro",  # Use pro model for deep research
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert research analyst. Provide comprehensive, well-structured research reports. Include relevant facts, figures, and context. Cite your sources."
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    "temperature": 0.1,
                    "max_tokens": 2048,
                },
            )

            if response.status_code != 200:
                return f"Perplexity API error: {response.status_code}"

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Add citations
            citations = data.get("citations", [])
            if citations:
                content += "\n\n---\n**Sources:**"
                for i, citation in enumerate(citations, 1):
                    content += f"\n{i}. {citation}"

            return content

    except httpx.TimeoutException:
        return "Error: Research request timed out (topic may be too broad)"
    except Exception as e:
        return f"Error performing research: {str(e)}"
