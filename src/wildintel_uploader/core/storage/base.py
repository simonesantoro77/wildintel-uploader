"""What the app needs of where it keeps its records — and nothing about how they are kept.

The **records** are what the app keeps of a research project: the project itself and, for each, its *locations*, *visits*, *unknown visits*, the *planned revisions*, *cameras*,
*SD cards*, *roles* and the *uploads that failed*; and, belonging to none, the *trappers*. They are plain `dict`s — the JSON the app has always kept, with the fields its models give them — so anything that can keep a
list of them under a research project can be a backend: a folder of JSON files today, a database tomorrow (see `register`).

What is **not** a record stays where it is: the images and what is written beside them (a deployment's `deployment.json`, `images.json`, the logs of a collection…) are
files of the collections folder, not rows of a table.

The rules of the records — the instants of the visits, the dates `created_at` and `updated_at`, which location can be removed — are the services' (`local_folder_service`),
above this layer: a backend only keeps and gives back. It never has to know what a visit is.
"""
from __future__ import annotations

import re
from abc import ABC, abstractmethod

# What is kept for each research project, besides the project itself. Each is a list of records, in the order they were kept. (Locations, cameras, SD cards and roles
# belong to the project; the trappers, the people, are global and are not here.)
RECORD_KINDS = ("locations", "visits", "unknown_visits", "planned_revisions", "cameras", "sd_cards", "roles", "upload_failures", "status_history")

# What is kept for all of them, belonging to no research project: the trappers, the people.
GLOBAL_KINDS = ("trappers",)

_PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


class StorageError(Exception):
    """The records cannot be read or kept — the message says why, for the person."""


def valid_project_id(research_project_id: str) -> str:
    """The id of a research project, if it can be one (it names its folder, so it has to be a folder name).

    Raises:
        StorageError: it cannot.
    """
    if not isinstance(research_project_id, str) or not _PROJECT_ID.match(research_project_id):
        raise StorageError(
            f"The research project id '{research_project_id}' can only have letters, digits, '_', '-' and '.' (and start with a letter or digit) to be a folder name."
        )
    return research_project_id


class ProjectStore(ABC):
    """Where the records of the research projects are kept. One is made by `storage.open_store`; to keep the records somewhere else, subclass it and `storage.register` it."""

    # ── the research projects ────────────────────────────────────────────────────────────────────────────────────────────

    @abstractmethod
    def list_projects(self) -> list[dict]:
        """Every research project kept, each as the record it was kept with — empty when there is none."""

    @abstractmethod
    def has_project(self, research_project_id: str) -> bool:
        """Whether the research project is kept.

        Raises:
            StorageError: the id cannot be one."""

    @abstractmethod
    def get_project(self, research_project_id: str) -> dict | None:
        """The record of the research project, or None when it is not kept."""

    @abstractmethod
    def add_project(self, project: dict) -> None:
        """Keeps a new research project — `project["acronym"]` is its id.

        Raises:
            StorageError: the acronym cannot be an id, or the research project is already kept."""

    @abstractmethod
    def save_project(self, research_project_id: str, project: dict) -> None:
        """Replaces the record of a research project that is kept.

        Raises:
            StorageError: the research project is not kept."""

    @abstractmethod
    def delete_project(self, research_project_id: str) -> None:
        """Forgets the research project and every record it has, **for good** — a purge. The app does not use it to delete: it removes *logically* (`deleted_at`, see
        services.audit), and keeps. Nothing happens when it is not kept."""

    def owned_names(self, research_project_id: str) -> set[str]:
        """The names the store keeps inside the research project's folder of the collections folder — a store that keeps its records elsewhere keeps none. What else is in the
        folder (collections, deployments, images) is not the store's."""
        return set()

    # ── the records of a research project ────────────────────────────────────────────────────────────────────────────────

    @abstractmethod
    def read_records(self, research_project_id: str, kind: str) -> list[dict]:
        """The records of this kind of the research project, in the order they were kept — empty until one is.

        Raises:
            StorageError: the id cannot be one, or the kind is not one of RECORD_KINDS."""

    @abstractmethod
    def write_records(self, research_project_id: str, kind: str, records: list[dict]) -> None:
        """Keeps these records as all of this kind of the research project — the whole list, replacing what was kept.

        Raises:
            StorageError: the research project is not kept, or the kind is not one of RECORD_KINDS."""

    def has_records(self, research_project_id: str, kind: str) -> bool:
        """Whether records of this kind were ever kept for the research project — kept empty is kept. A store that cannot tell an empty list from none says whether it has any."""
        return bool(self.read_records(research_project_id, kind))

    @abstractmethod
    def delete_records(self, research_project_id: str, kind: str) -> None:
        """Forgets every record of this kind of the research project — as if none were ever kept."""

    # ── the records that belong to no research project ───────────────────────────────────────────────────────────────────

    @abstractmethod
    def read_global(self, kind: str) -> list[dict]:
        """The records of this kind — one of GLOBAL_KINDS —, in the order they were kept; empty until one is.

        Raises:
            StorageError: the kind is not one of GLOBAL_KINDS."""

    @abstractmethod
    def write_global(self, kind: str, records: list[dict]) -> None:
        """Keeps these records as all of this kind — the whole list, replacing what was kept.

        Raises:
            StorageError: the kind is not one of GLOBAL_KINDS."""
