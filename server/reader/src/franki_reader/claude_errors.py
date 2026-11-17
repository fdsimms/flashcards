"""What to tell the owner when a call to Claude fails.

The API reports a spent monthly limit or an empty credit balance as a 400 (BadRequestError), which
reads as a bug in the app. It's a setting on the Claude Console, so it gets its own message.

Every failed call goes through `didnt_answer`, which also logs the API's own message: the person
sees only the error's class name, and what a 400 objected to is what says why.
"""

import logging

import anthropic

log = logging.getLogger(__name__)

SPEND_LIMIT = (
    "Claude's monthly spend limit is reached, so nothing can be written until it resets. "
    "Raise the limit in the Claude Console, under Settings, Limits."
)

# Phrases the API uses for a limit or balance rather than for a malformed request.
_LIMIT_PHRASES = ("usage limit", "spend limit", "credit balance")


def spend_limit_message(e: anthropic.APIError) -> str | None:
    """SPEND_LIMIT when `e` is the API refusing because of the organization's limit or balance."""
    if isinstance(e, anthropic.BadRequestError):
        text = str(e).lower()
        if any(phrase in text for phrase in _LIMIT_PHRASES):
            return SPEND_LIMIT
    return None


def didnt_answer(e: anthropic.APIError, ending: str = "", *, doing: str = "answer") -> str:
    """The message for a failed call: the limit's own message, else "Claude didn't answer
    (ErrorName)" followed by `ending`, which brings its own punctuation.

    Logs the API's own message first, as "Claude couldn't <doing>", so the server log says why
    whichever call failed. `doing` names the call ("explain kot") where that helps.
    """
    log.warning("Claude couldn't %s: %s: %s", doing, type(e).__name__, e, stacklevel=2)
    return spend_limit_message(e) or f"Claude didn't answer ({type(e).__name__}){ending}"
