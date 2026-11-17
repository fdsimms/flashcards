import logging

import anthropic
import httpx2
import pytest

from franki_reader.claude_errors import SPEND_LIMIT, didnt_answer, spend_limit_message


def bad_request(message: str) -> anthropic.BadRequestError:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx2.Response(400, request=request)
    return anthropic.BadRequestError(message, response=response, body=None)


def test_a_spent_limit_gets_its_own_message() -> None:
    e = bad_request("You have reached your specified API usage limits.")
    assert spend_limit_message(e) == SPEND_LIMIT
    assert didnt_answer(e, ". Try again in a moment.") == SPEND_LIMIT


def test_an_empty_balance_is_read_the_same_way() -> None:
    assert spend_limit_message(bad_request("Your credit balance is too low.")) == SPEND_LIMIT


def test_another_bad_request_keeps_the_error_name() -> None:
    e = bad_request("messages: text content blocks must be non-empty")
    assert spend_limit_message(e) is None
    assert didnt_answer(e, ". Try again in a moment.") == (
        "Claude didn't answer (BadRequestError). Try again in a moment."
    )


def test_other_errors_keep_the_error_name() -> None:
    e = anthropic.APIConnectionError(request=httpx2.Request("POST", "https://x"))
    assert didnt_answer(e) == "Claude didn't answer (APIConnectionError)"


def test_a_failed_call_logs_the_apis_own_message(caplog: pytest.LogCaptureFixture) -> None:
    e = bad_request("messages: text content blocks must be non-empty")
    with caplog.at_level(logging.WARNING, logger="franki_reader.claude_errors"):
        didnt_answer(e, doing="explain kot")
    assert "Claude couldn't explain kot: BadRequestError" in caplog.text
    assert "text content blocks must be non-empty" in caplog.text
