import asyncio

import pytest

from franki_reader.once import Once


def test_a_second_call_for_the_same_key_waits_for_the_first() -> None:
    calls: list[str] = []

    async def make(key: str) -> str:
        calls.append(key)
        await asyncio.sleep(0.01)
        return f"answer for {key}"

    async def scenario() -> list[str]:
        once: Once[str] = Once()
        answers = await asyncio.gather(
            once.run("a", lambda: make("a")),
            once.run("a", lambda: make("a")),
            once.run("b", lambda: make("b")),
        )
        assert not once  # nothing left on its way
        return list(answers)

    assert asyncio.run(scenario()) == ["answer for a", "answer for a", "answer for b"]
    assert calls == ["a", "b"]


def test_a_failure_reaches_every_waiter_and_the_next_call_tries_again() -> None:
    tries = 0

    async def make() -> str:
        nonlocal tries
        tries += 1
        await asyncio.sleep(0.01)
        if tries == 1:
            raise RuntimeError("Claude didn't answer")
        return "ok"

    async def scenario() -> str:
        once: Once[str] = Once()
        results = await asyncio.gather(
            once.run("k", make), once.run("k", make), return_exceptions=True
        )
        assert all(isinstance(r, RuntimeError) for r in results)
        return await once.run("k", make)

    assert asyncio.run(scenario()) == "ok"
    assert tries == 2


def test_a_waiter_given_up_on_leaves_the_call_running_for_the_others() -> None:
    async def make() -> str:
        await asyncio.sleep(0.02)
        return "done"

    async def scenario() -> str:
        once: Once[str] = Once()
        first = asyncio.ensure_future(once.run("k", make))
        second = asyncio.ensure_future(once.run("k", make))
        await asyncio.sleep(0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        return await second

    assert asyncio.run(scenario()) == "done"
