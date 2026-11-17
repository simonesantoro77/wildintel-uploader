"""The JSON files of the records under requests that come together (#32): reading writes nothing, a file is read and written one request at a time, and a file the system says is in use is
tried again."""
import json
import os
import threading
from pathlib import Path
from unittest.mock import patch

import pytest

from wildintel_uploader.core.services import local_folder_service as svc
from wildintel_uploader.core.storage import json_files


def test_reading_records_kept_before_the_ids_existed_gives_them_ids_but_writes_nothing(tmp_path: Path):
    svc.write_research_project(tmp_path, {"name": "Doñana", "acronym": "DONA"})
    locations = tmp_path / "DONA" / "locations.json"
    locations.write_text(json.dumps([{"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 1, "longitude": 1}]), encoding="utf-8")
    (tmp_path / "trappers.json").write_text(json.dumps([{"username": "ana", "name": "Ana Pérez"}]), encoding="utf-8")
    before = {p: (p.read_text(encoding="utf-8"), p.stat().st_mtime_ns) for p in (locations, tmp_path / "trappers.json")}

    first = svc.list_locations(tmp_path, "DONA")
    again = svc.list_locations(tmp_path, "DONA")
    people = svc.list_trappers(tmp_path)

    assert first[0]["id"] and first == again and people[0]["id"]                       # the same ids whenever they are read
    assert {p: (p.read_text(encoding="utf-8"), p.stat().st_mtime_ns) for p in before} == before   # and the files are as they were


def test_requests_that_read_and_write_the_same_file_together_do_not_fail_or_leave_it_half_written(tmp_path: Path):
    path = tmp_path / "locations.json"
    json_files.write_json(path, [{"n": 0}])
    errors: list[BaseException] = []
    seen: list[object] = []

    def writer(k: int) -> None:
        try:
            for i in range(25):
                json_files.write_json(path, [{"n": k * 100 + i}] * 50)
        except BaseException as exc:   # noqa: BLE001
            errors.append(exc)

    def reader() -> None:
        try:
            for _ in range(100):
                seen.append(json_files.read_json(path))
        except BaseException as exc:   # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(k,)) for k in range(4)] + [threading.Thread(target=reader) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert not errors and not any(t.is_alive() for t in threads)
    assert all(isinstance(s, list) and len(s) in (1, 50) for s in seen)                # never None: a file is whole whenever it is read
    assert not list(tmp_path.glob(".*.tmp"))                                           # and no file of a write is left behind


def test_a_file_that_the_system_says_is_in_use_is_tried_again_and_the_error_is_said_when_it_stays_so(tmp_path: Path):
    path = tmp_path / "visits.json"
    real, calls = os.replace, []

    def busy_twice(src, dst):
        calls.append(1)
        if len(calls) <= 2:
            raise PermissionError(5, "Acceso denegado")
        return real(src, dst)

    with patch("wildintel_uploader.core.storage.json_files.time.sleep") as sleep, patch("wildintel_uploader.core.storage.json_files.os.replace", side_effect=busy_twice):
        json_files.write_json(path, [{"a": 1}])
    assert json.loads(path.read_text(encoding="utf-8")) == [{"a": 1}] and len(calls) == 3 and sleep.call_count == 2

    with patch("wildintel_uploader.core.storage.json_files.time.sleep"), patch("wildintel_uploader.core.storage.json_files.os.replace", side_effect=PermissionError(5, "Acceso denegado")):
        with pytest.raises(PermissionError):
            json_files.write_json(path, [{"a": 2}])
    assert json.loads(path.read_text(encoding="utf-8")) == [{"a": 1}]                  # it stays as it was
    assert not list(tmp_path.glob(".*.tmp"))


def test_the_lock_of_a_file_can_be_taken_again_by_what_holds_it(tmp_path: Path):
    path = tmp_path / "roles.json"
    with json_files._lock_of(path):
        json_files.write_json(path, [1])
        assert json_files.read_json(path) == [1]
    assert json_files._lock_of(path) is json_files._lock_of(tmp_path / "." / "roles.json")             # one lock for a file, however its path is told
