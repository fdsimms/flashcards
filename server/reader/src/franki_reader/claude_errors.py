"""What to tell the owner when a call to Claude fails.

The API reports a spent monthly limit or an empty credit balance as a 400 (BadRequestError), which
reads as a bug in the app. It's a setting on the Claude Console, so it gets its own message.
"""

import anthropic

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


def didnt_answer(e: anthropic.APIError, ending: str = "") -> str:
    """The message for a failed call: the limit's own message, else "Claude didn't answer
    (ErrorName)" followed by `ending`, which brings its own punctuation."""
    return spend_limit_message(e) or f"Claude didn't answer ({type(e).__name__}){ending}"
