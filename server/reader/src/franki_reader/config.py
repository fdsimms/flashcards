"""Server settings, all from the environment. Secrets come from the sync server's `.env` (through
docker-compose.yml) and never reach the app on the phone; server/README.md lists them."""

import os
from dataclasses import dataclass
from pathlib import Path

from franki_reader.tts import DEFAULT_VOICES

# Names of the secrets the server reads. Missing ones are allowed at startup, so the server can be
# deployed and health-checked before every key exists; the feature that needs one says so.
SECRET_NAMES = (
    "ANTHROPIC_API_KEY",
    "AZURE_SPEECH_KEY",
    "AZURE_SPEECH_REGION",
    "ANKI_SYNC_ENDPOINT",
    "ANKI_USER",
    "ANKI_PASSWORD",
    "APP_PASSPHRASE",
    # A second key that opens only `GET /api/status` (what's due), for another app such as
    # dundundun: it can't write texts or spend anything, unlike the passphrase.
    "STATUS_TOKEN",
)


@dataclass(frozen=True)
class Settings:
    db_path: Path
    audio_dir: Path
    anki_dir: Path  # the reader's own copy of the Anki collection, kept in step by sync
    speech_endpoint: str | None  # another Azure host than the region's, rarely needed
    voices: dict[str, str]
    secrets: dict[str, str]

    def missing(self) -> list[str]:
        return [name for name in SECRET_NAMES if not self.secrets.get(name)]


def load(env: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ) if env is None else env
    return Settings(
        db_path=Path(env.get("READER_DB_PATH", "reader.db")),
        audio_dir=Path(env.get("READER_AUDIO_DIR", "audio")),
        anki_dir=Path(env.get("READER_ANKI_DIR", "anki")),
        speech_endpoint=env.get("AZURE_SPEECH_ENDPOINT") or None,
        voices={
            "male": env.get("AZURE_VOICE_MALE") or DEFAULT_VOICES["male"],
            "female": env.get("AZURE_VOICE_FEMALE") or DEFAULT_VOICES["female"],
        },
        secrets={name: env[name] for name in SECRET_NAMES if env.get(name)},
    )
