"""Builds the MCP server: the tools on a collection, behind sign-in when it's served over HTTP."""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from franki_speech.commons import Commons

from . import audits as audits_module
from . import forms, frequency, known_words, lint, native, pronunciation, skills, stress, tiers, tools
from . import reader as reader_tools
from .audits import AuditStore
from .collection import CollectionManager
from .downloads import AudioFetcher
from .reader import ReaderClient, ReaderSettings
from .speech import SpeechClient


def build_server(cm: CollectionManager, speech: SpeechClient | None = None, unimorph: forms.UniMorph | None = None,
                 reader_settings: ReaderSettings | None = None, reader: ReaderClient | None = None,
                 downloads: AudioFetcher | None = None, commons: Commons | None = None,
                 audits: AuditStore | None = None, **kwargs) -> MCPServer:
    """The server with every tool. kwargs go to MCPServer (sign-in settings, for one)."""
    server = MCPServer("Franki", instructions=tools.INSTRUCTIONS, **kwargs)
    # Read & Listen's server (optional): its costs, word ranks and Japanese readings.
    client = reader or ReaderClient(reader_settings)
    # add_audio_from_url's downloads: a real fetcher unless a test passes a faked one.
    # Native speakers' recordings from Wikimedia Commons (tests pass one with a faked network).
    recorder = native.NativeRecorder(cm, commons or Commons(user_agent="franki-mcp-native/1.0"))
    # Content audits: their definitions, and what's been checked and found, kept beside the collection's folder.
    store = audits or AuditStore(cm.path.parent.parent / "audits.sqlite")
    tools.register(server, cm, speech, client, downloads, recorder, store)
    audits_module.register(server, cm, store, client)
    native.register(server, cm, recorder)
    # Wiktionary's inflection tables, kept beside the collection's folder.
    tables = unimorph or forms.UniMorph(cm.path.parent.parent / "unimorph")
    forms.register(server, cm, tables, client)
    reader_tools.register(server, client)
    # The Omnilanguage house style: its guide, its lint and the cards a note no longer makes.
    lint.register(server, cm)
    # IPA for the Pronunciation field, from the same server.
    pronunciation.register(server, cm, client)
    # A Russian word's stress mark for the Stress field, from the same Wiktionary pages as the tables.
    stress.register(server, cm, tables)
    # Ordering new cards by how common the word is, with the ranks from the same server.
    frequency.register(server, cm, client)
    # Skill cards: the app's drills and single cards, added by the hourly job where a deck's switch is on.
    skills.register(server, cm)
    # Filing a language deck's notes into tier subdecks, each with its own desired retention.
    tiers.register(server, cm, client)
    # Which words the collection already has, matched by the forms each note lists.
    known_words.register(server, cm)
    return server
