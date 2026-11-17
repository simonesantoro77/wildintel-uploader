"""The notes of a file of visits about the sites that have no visit in a revision (#38)."""
from wildintel_uploader.core.services import visit_rules


def _visit(location: str, session: str, date: str, actions: list[str], camera: str, photos: int | None = None) -> dict:
    return {"location_id": location, "session": session, "date": date, "time": "10:00:00", "when": f"{date}T10:00:00Z", "actions": actions, "camera_id": camera, "num_photos": photos}


def test_the_note_of_a_site_not_visited_leaves_out_the_ones_archived_or_without_camera_in_the_trip_before():
    """R0043 has no visit to a site archived in R0042: it is not told, its camera is not out in the field."""
    kept = [_visit("DONA_01", "R0042", "2026-03-01", ["Revision"], "C1", 10), _visit("DONA_02", "R0042", "2026-03-01", ["Archive"], "C2"),
            _visit("DONA_03", "R0042", "2026-03-01", ["Desinstallation"], "C3", 10), _visit("DONA_04", "R0042", "2026-03-01", ["Stolen"], "C4"),
            _visit("DONA_05", "R0042", "2026-03-01", ["Revision"], "C5", 10)]
    new = [_visit("DONA_01", "R0043", "2026-05-01", ["Revision"], "C1", 10)]

    notes = visit_rules.history_notes(new, kept)

    assert len(notes) == 1 and "DONA_05" in notes[0]
    assert not any(site in notes[0] for site in ("DONA_02", "DONA_03", "DONA_04"))
