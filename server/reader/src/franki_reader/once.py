"""One paid call at a time per key: a second request for the same thing while the first is on its
way (a double tap, or the reader's prefetch beside its own request) waits for that one's answer
rather than paying Azure or Claude for another."""

import asyncio
from collections.abc import Awaitable, Callable, Hashable
from typing import Generic, TypeVar

T = TypeVar("T")


class Once(Generic[T]):
    def __init__(self) -> None:
        self._running: dict[Hashable, asyncio.Future[T]] = {}

    async def run(self, key: Hashable, make: Callable[[], Awaitable[T]]) -> T:
        running = self._running.get(key)
        if running is None:
            running = asyncio.ensure_future(make())
            self._running[key] = running
            running.add_done_callback(lambda _: self._running.pop(key, None))
        # Shielded: a request given up on (the app left the line) doesn't stop the call another
        # request is waiting on.
        return await asyncio.shield(running)

    def __bool__(self) -> bool:
        """Whether a call is on its way."""
        return bool(self._running)
