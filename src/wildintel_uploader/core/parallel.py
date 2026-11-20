"""Doing the same thing to many images at once. The work is Pillow decoding and hashing, which let go of
Python's lock while they run, so threads use as many CPUs as there are workers — and, unlike processes,
they cost nothing to start and work the same in the packaged app."""
from __future__ import annotations

from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TypeVar

from wildintel_uploader.core import config

T = TypeVar("T")
R = TypeVar("R")


def pmap(function: Callable[[T], R], items: Iterable[T], workers: int | None = None, progress: Callable[[int], None] | None = None) -> list[R]:
    """`function` applied to each item — `workers` at a time, GENERAL.workers by default — with the results in
    the order of the items, so what is reported never depends on which finished first.
    `progress`, if given, is called with how many items are done each time one is, always from the thread that called pmap."""
    items = list(items)
    workers = config.workers() if workers is None else workers
    if workers <= 1 or len(items) <= 1:
        results = []
        for item in items:
            results.append(function(item))
            if progress:
                progress(len(results))
        return results
    with ThreadPoolExecutor(max_workers=min(workers, len(items))) as pool:
        futures = [pool.submit(function, item) for item in items]
        if progress:
            for done, _ in enumerate(as_completed(futures), start=1):
                progress(done)
        return [future.result() for future in futures]
