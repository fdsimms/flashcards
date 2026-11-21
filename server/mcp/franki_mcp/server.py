"""Builds the MCP server: the tools on a collection, behind sign-in when it's served over HTTP."""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from . import forms, frequency, known_words, lint, pronunciation, skills, tiers, tools
from . import reader as reader_tools
from .collection import CollectionManager
from .reader import ReaderClient, ReaderSettings
from .speech import SpeechClient


def build_server(cm: CollectionManager, speech: SpeechClient | None = None, unimorph: forms.UniMorph | None = None,
                 reader_settings: ReaderSettings | None = None, reader: ReaderClient | None = None, **kwargs) -> MCPServer:
    """The server with every tool. kwargs go to MCPServer (sign-in settings, for one)."""
    server = MCPServer("Franki", instructions=tools.INSTRUCTIONS, **kwargs)
    # Read & Listen's server (optional): its costs, word ranks and Japanese readings.
    client = reader or ReaderClient(reader_settings)
    tools.register(server, cm, speech, client)
    # Wiktionary's inflection tables, kept beside the collection's folder.
    forms.register(server, cm, unimorph or forms.UniMorph(cm.path.parent.parent / "unimorph"), client)
    reader_tools.register(server, client)
    # The Omnilanguage house style: its guide, its lint and the cards a note no longer makes.
    lint.register(server, cm)
    # IPA for the Pronunciation field, from the same server.
    pronunciation.register(server, cm, client)
    # Ordering new cards by how common the word is, with the ranks from the same server.
    frequency.register(server, cm, client)
    # Skill cards: the app's drills and single cards, added by the hourly job where a deck's switch is on.
    skills.register(server, cm)
    # Filing a language deck's notes into tier subdecks, each with its own desired retention.
    tiers.register(server, cm, client)
    # Which words the collection already has, matched by the forms each note lists.
    known_words.register(server, cm)
    return server
