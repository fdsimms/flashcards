"""Builds the MCP server: the tools on a collection, behind sign-in when it's served over HTTP."""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from . import tools
from .collection import CollectionManager
from .speech import SpeechClient


def build_server(cm: CollectionManager, speech: SpeechClient | None = None, **kwargs) -> MCPServer:
    """The server with every tool. kwargs go to MCPServer (sign-in settings, for one)."""
    server = MCPServer("Franki", instructions=tools.INSTRUCTIONS, **kwargs)
    tools.register(server, cm, speech)
    return server
