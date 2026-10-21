"""config.py — settings.toml roundtrip and the derived data directory."""
from pathlib import Path

import pytest

from wildintel_uploader.core import config


def test_settings_roundtrip(tmp_path: Path):
    config_file = tmp_path / "settings.toml"
    settings = config.load_settings(config_file)
    assert settings.TRAPPER.base_url is None
    assert settings.GENERAL.log_level == "INFO"

    settings.TRAPPER.base_url = "https://trapper.example.org"
    settings.TRAPPER.user_name = "alice"
    settings.TRAPPER.user_password = "s3cret"
    config.save_settings(settings, config_file)

    reloaded = config.load_settings(config_file)
    assert reloaded.TRAPPER.base_url == "https://trapper.example.org"
    assert reloaded.TRAPPER.user_name == "alice"
    assert reloaded.TRAPPER.user_password == "s3cret"


def test_data_dir_defaults_when_unset():
    settings = config.Settings()
    assert config.data_dir(settings) == config.default_data_dir()


def test_data_dir_honors_override():
    settings = config.Settings()
    settings.DATA.dir = "/tmp/somewhere"
    assert config.data_dir(settings) == Path("/tmp/somewhere")


def test_the_validation_checks_are_all_shown_by_default():
    settings = config.Settings()

    assert all(vars(settings.VALIDATION).values())
    assert set(vars(settings.VALIDATION)) == {"corrupted", "sequence", "structure", "camera", "exif", "duplicates"}
    checks = {k: v for k, v in vars(settings.POSTVALIDATION).items() if isinstance(v, bool)}
    assert all(v for k, v in checks.items() if k != "camera")
    assert checks["camera"] is False  # the camera id comes from the field records, not from the camera
    assert set(checks) == {
        "deployment_id", "collection_prefix", "collection_name", "location", "time_range", "camera",
        "image_count", "sequence_count", "sequence_length",
    }


def test_the_statistical_checks_default_to_a_minute_gap_two_revisions_the_median_and_fifty_percent():
    post = config.Settings().POSTVALIDATION

    assert post.sequence_gap_seconds == 60.0
    assert post.min_revisions == 2
    assert post.similarity_method == "median"
    assert (post.image_count_tolerance, post.sequence_count_tolerance, post.sequence_length_tolerance) == (50.0, 50.0, 50.0)


@pytest.mark.parametrize("bad", [
    {"sequence_gap_seconds": 0}, {"sequence_gap_seconds": -5}, {"sequence_gap_seconds": 90000}, {"min_revisions": 0}, {"min_revisions": 51},
    {"similarity_method": "mode"}, {"image_count_tolerance": -1}, {"sequence_count_tolerance": 1001}, {"sequence_length_tolerance": -0.1},
])
def test_the_statistical_parameters_have_limits(bad):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        config.PostvalidationSettings(**bad)


def test_the_postvalidation_tolerance_defaults_to_the_one_hour_of_wildintel_tools():
    assert config.Settings().POSTVALIDATION.tolerance_hours == 1.0


def test_which_checks_are_shown_survives_a_roundtrip(tmp_path: Path):
    config_file = tmp_path / "settings.toml"
    settings = config.load_settings(config_file)
    settings.VALIDATION.duplicates = False
    settings.POSTVALIDATION.location = False
    settings.POSTVALIDATION.tolerance_hours = 2.5
    config.save_settings(settings, config_file)

    reloaded = config.load_settings(config_file)

    assert reloaded.VALIDATION.duplicates is False and reloaded.VALIDATION.corrupted is True
    assert reloaded.POSTVALIDATION.location is False and reloaded.POSTVALIDATION.deployment_id is True
    assert reloaded.POSTVALIDATION.tolerance_hours == 2.5


def test_a_settings_file_from_before_these_sections_still_loads_with_every_check_shown(tmp_path: Path):
    config_file = tmp_path / "settings.toml"
    config_file.write_text('[GENERAL]\nlog_level = "INFO"\n\n[TRAPPER]\nbase_url = "https://trapper.example.org"\n', encoding="utf-8")

    settings = config.load_settings(config_file)

    assert settings.TRAPPER.base_url == "https://trapper.example.org"
    assert settings.VALIDATION.exif is True and settings.POSTVALIDATION.time_range is True


def test_the_tolerance_cannot_be_negative():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        config.PostvalidationSettings(tolerance_hours=-1)


def test_the_data_folder_has_to_be_an_absolute_path_and_blank_means_the_default():
    import pytest
    from pydantic import ValidationError

    assert config.DataSettings(dir="  ").dir is None
    assert config.DataSettings(dir="/data/images").dir == "/data/images"
    assert config.DataSettings(dir="~/images").dir == "~/images"
    with pytest.raises(ValidationError, match="absolute"):
        config.DataSettings(dir="relative/images")


def test_a_data_folder_starting_with_a_tilde_means_the_users_home():
    settings = config.Settings(DATA=config.DataSettings(dir="~/images"))

    assert config.data_dir(settings) == Path("~/images").expanduser()
    assert config.collections_dir(settings) == Path("~/images").expanduser() / "collections"


def test_the_preprocessing_defaults_are_the_ones_of_wildintel_tools():
    pre = config.Settings().PREPROCESSING

    assert (pre.rename, pre.resize, pre.resize_width, pre.metadata) == (True, True, 2400, True)
    assert pre.license_url == "https://creativecommons.org/licenses/by-nc/4.0/"
    assert (pre.ignore_dst, pre.convert_to_utc) == (True, True)
    assert (pre.owner, pre.publisher, pre.coverage) == ("", "", "")


def test_the_preprocessing_settings_survive_a_roundtrip_and_text_is_stripped(tmp_path: Path):
    config_file = tmp_path / "settings.toml"
    settings = config.load_settings(config_file)
    settings.PREPROCESSING.resize = False
    settings.PREPROCESSING.resize_width = 1600
    settings.PREPROCESSING.owner = "  Universidad de Huelva  "
    settings.PREPROCESSING.coverage = "Doñana National Park"
    config.save_settings(config.Settings.model_validate(settings.model_dump()), config_file)

    reloaded = config.load_settings(config_file).PREPROCESSING

    assert reloaded.resize is False and reloaded.resize_width == 1600 and reloaded.rename is True
    assert reloaded.owner == "Universidad de Huelva" and reloaded.coverage == "Doñana National Park"


import pytest


@pytest.mark.parametrize("bad", [{"resize_width": 99}, {"resize_width": 20001}])
def test_the_resize_width_has_limits(bad):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        config.PreprocessingSettings(**bad)


# ── how many images are worked on at once ────────────────────────────────────

def test_the_workers_default_to_the_cpus_up_to_four(monkeypatch):
    monkeypatch.setattr(config.os, "cpu_count", lambda: 22)
    assert config.default_workers() == 4
    monkeypatch.setattr(config.os, "cpu_count", lambda: 2)
    assert config.default_workers() == 2
    monkeypatch.setattr(config.os, "cpu_count", lambda: None)
    assert config.default_workers() == 1


@pytest.mark.parametrize("bad", [0, -1, 65])
def test_the_workers_must_be_between_one_and_sixty_four(bad):
    with pytest.raises(ValueError):
        config.GeneralSettings(workers=bad)


def test_the_workers_are_saved_with_the_settings(tmp_path: Path):
    config_file = tmp_path / "settings.toml"
    settings = config.load_settings(config_file)
    settings.GENERAL.workers = 6
    config.save_settings(settings, config_file)

    assert config.load_settings(config_file).GENERAL.workers == 6
    assert config.workers(config.load_settings(config_file)) == 6
