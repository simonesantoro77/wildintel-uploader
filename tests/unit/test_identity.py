from wildintel_uploader.core import config, identity


def test_an_sd_card_a_camera_and_a_trapper_are_the_same_only_when_written_the_same():
    for kind in ("sd", "camera", "trapper"):
        assert identity.key(kind, " 7b ") == "7b" and identity.key(kind, "7b") != identity.key(kind, "7B")
        assert identity.same(kind, "7B", " 7B") and not identity.same(kind, "7b", "7B")


def test_a_site_is_read_whatever_its_case_as_its_name_is_a_folder_and_trapper_keeps_its_ids_in_lower_case():
    assert identity.same("location", "DONA_01", "dona_01") and identity.key("location", " DONA_01 ") == "dona_01"
    assert identity.same("research_project", "DONA", "dona")


def test_two_sd_cards_that_differ_only_in_case_are_two_in_the_settings():
    cards = config.FieldworkSettings(sd_cards=[{"label": "7b", "research_project": "DONA"}, {"label": "7B", "research_project": "DONA"}, {"label": "7b", "research_project": "dona"}]).sd_cards
    assert [c.label for c in cards] == ["7b", "7B"]                                     # 7b once — the research project is read whatever its case —, and 7B
