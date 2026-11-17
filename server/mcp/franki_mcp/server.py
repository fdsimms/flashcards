"""Builds the MCP server: the tools on a collection, behind sign-in when it's served over HTTP."""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from . import forms, frequency, tiers, tools
from . import reader as reader_tools
from .collection import CollectionManager
from .reader import ReaderClient, ReaderSettings
from .speech import SpeechClient


def build_server(cm: CollectionManager, speech: SpeechClient | None = None, unimorph: forms.UniMorph | None = None,
                 reader_settings: ReaderSettings | None = None, reader: ReaderClient | None = None, **kwargs) -> MCPServer:
    """The server with every tool. kwargs go to MCPServer (sign-in settings, for one)."""
    server = MCPServer("Franki", instructions=tools.INSTRUCTIONS, **kwargs)
    tools.register(server, cm, speech)
    # Wiktionary's inflection tables, kept beside the collection's folder.
    forms.register(server, cm, unimorph or forms.UniMorph(cm.path.parent.parent / "unimorph"))
    # Read & Listen's costs, from its own server (optional).
    client = reader or ReaderClient(reader_settings)
    reader_tools.register(server, client)
    # Ordering new cards by how common the word is, with the ranks from the same server.
    frequency.register(server, cm, client)
    # Filing a language deck's notes into tier subdecks, each with its own desired retention.
    tiers.register(server, cm, client)
    return server
