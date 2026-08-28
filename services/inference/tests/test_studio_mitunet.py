from app.studio.dataset import MITUNET_BASE_ID, assert_base_model, list_base_models
from app.studio.mitunet_train import is_mitunet_base, wall_class_indices


def test_assert_base_model_mitunet() -> None:
    assert assert_base_model("segment", "mitunet") == MITUNET_BASE_ID
    assert assert_base_model("segment", MITUNET_BASE_ID) == MITUNET_BASE_ID


def test_mitunet_in_segment_catalog() -> None:
    seg = list_base_models("segment")
    ids = {item["id"] for item in seg}
    assert MITUNET_BASE_ID in ids


def test_wall_class_indices_prefers_wall_labels() -> None:
    names = ["Bedroom", "Wall", "External Wall"]
    assert wall_class_indices(names) == {1, 2}


def test_is_mitunet_base_aliases() -> None:
    assert is_mitunet_base("wall:mitunet")
    assert is_mitunet_base(MITUNET_BASE_ID)
