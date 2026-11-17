"""The time of a visit: kept as an instant — ISO 8601, UTC, with a Z (`2024-09-04T11:10:00Z`) — and told as the wall clock of its location, in the
timezone the location says (UTC unless it says another, and with summer time unless it ignores it). The day and the time the forms, the tables and
the deployments' dates speak of are that wall clock; what is kept is the instant."""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "UTC"
_UTC = dt.timezone.utc


#: The names UTC goes by: it has no summer time, so what a location says of it does not apply there.
_UTC_ZONES = frozenset({"utc", "etc/utc", "etc/uct", "uct", "gmt", "etc/gmt", "zulu", "etc/zulu", "universal", "etc/universal", "z"})


def is_utc(zone: str | None) -> bool:
    """Whether a timezone is UTC — which has no summer time."""
    return (zone or "").strip().lower() in _UTC_ZONES


def _zone(location: dict | None) -> tuple[ZoneInfo, bool]:
    name = (location or {}).get("timezone") or DEFAULT_TIMEZONE
    try:
        zone = ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo(DEFAULT_TIMEZONE)
    return zone, bool((location or {}).get("ignore_dst"))


def _standard_offset(zone: ZoneInfo, year: int) -> dt.timedelta:
    """The offset of the zone without summer time: the smaller of January's and July's."""
    return min(dt.datetime(year, m, 1, tzinfo=zone).utcoffset() for m in (1, 7))


def utc_to_local(instant: dt.datetime, location: dict | None) -> dt.datetime:
    """An instant (naive, UTC) as the wall clock of the location — with no summer time when the location ignores it."""
    zone, ignore_dst = _zone(location)
    utc = instant.replace(tzinfo=_UTC)
    if ignore_dst:
        return (utc + _standard_offset(zone, instant.year)).replace(tzinfo=None)
    return utc.astimezone(zone).replace(tzinfo=None)


def local_to_utc(wall: dt.datetime, location: dict | None) -> dt.datetime:
    """The wall clock of a location (naive) as an instant (naive, UTC)."""
    zone, ignore_dst = _zone(location)
    if ignore_dst:
        return wall - _standard_offset(zone, wall.year)
    return wall.replace(tzinfo=zone).astimezone(_UTC).replace(tzinfo=None)


def to_when(date: str, time: str, location: dict | None) -> str:
    """The instant of a visit as ISO 8601 in UTC with a Z, from its day and time on the wall clock of its location."""
    wall = dt.datetime.fromisoformat(f"{date}T{time}")
    return local_to_utc(wall, location).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_wall(when: str, location: dict | None) -> tuple[str, str]:
    """The day (YYYY-MM-DD) and the time (HH:MM:SS) of a visit's instant on the wall clock of its location."""
    instant = dt.datetime.fromisoformat(when.replace("Z", "+00:00"))
    if instant.tzinfo is not None:
        instant = instant.astimezone(_UTC).replace(tzinfo=None)
    wall = utc_to_local(instant, location)
    return wall.date().isoformat(), wall.time().replace(microsecond=0).isoformat()
