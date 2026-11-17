"""A revision after a gap (#37): the site was skipped in one revision and revised in the next."""
from wildintel_uploader.core.services import visit_rules


def _visit(location: str, session: str, date: str, actions: list[str], camera: str) -> dict:
    return {"location_id": location, "session": session, "date": date, "time": "10:00:00", "when": f"{date}T10:00:00Z", "actions": actions, "camera_id": camera}


def _said(kept: list[dict], new: list[dict]) -> list[str]:
    return visit_rules.unknown_installation_warnings(new, kept, visit_rules.unknown_records(new, kept))


def test_a_revision_after_a_gap_is_fine_while_the_camera_is_still_out():
    kept = [_visit("DONA_03", "R0001", "2026-01-10", ["Installation"], "C3")]
    new = [_visit("DONA_01", "R0002", "2026-03-01", ["Revision"], "C1"), _visit("DONA_01", "R0003", "2026-05-01", ["Revision"], "C1"),
           _visit("DONA_03", "R0003", "2026-05-01", ["Revision"], "C3")]   # DONA_03 was not visited in R0002, and its camera is out since R0001

    assert _said(kept, new) == []


def test_a_revision_after_a_gap_is_told_when_the_camera_was_taken_away_before_it():
    kept = [_visit("DONA_03", "R0001", "2026-01-10", ["Installation"], "C3"), _visit("DONA_03", "R0001", "2026-02-10", ["Desinstallation"], "C3")]
    new = [_visit("DONA_01", "R0002", "2026-03-01", ["Revision"], "C1"), _visit("DONA_01", "R0003", "2026-05-01", ["Revision"], "C1"),
           _visit("DONA_03", "R0003", "2026-05-01", ["Revision"], "C3")]

    assert any("R0003 DONA_03" in m and "Installation" in m for m in _said(kept, new))


def test_a_revision_after_a_gap_is_told_when_the_site_had_no_camera_before_it():
    new = [_visit("DONA_01", "R0002", "2026-03-01", ["Revision"], "C1"), _visit("DONA_01", "R0003", "2026-05-01", ["Revision"], "C1"),
           _visit("DONA_03", "R0003", "2026-05-01", ["Revision"], "C3")]

    assert any("R0003 DONA_03" in m for m in _said([], new))
