"""Preview confinement regressions discovered while auditing computer evidence routes."""
from foundry_kernel.api.preview import resolve_preview


def test_preview_directory_index_symlink_cannot_escape(tmp_path):
    root = tmp_path / "workspaces" / "ven_test" / "tkt_test" / "dist"
    (root / "nested").mkdir(parents=True)
    outside = tmp_path / "private.txt"
    outside.write_text("private")
    (root / "nested" / "index.html").symlink_to(outside)
    assert resolve_preview(tmp_path, "ven_test", "tkt_test", "nested") is None


def test_preview_workspace_symlink_cannot_escape(tmp_path):
    workspaces = tmp_path / "workspaces"
    workspaces.mkdir()
    outside = tmp_path / "outside"
    (outside / "tkt_test" / "dist").mkdir(parents=True)
    (outside / "tkt_test" / "dist" / "index.html").write_text("private")
    (workspaces / "ven_test").symlink_to(outside, target_is_directory=True)
    assert resolve_preview(tmp_path, "ven_test", "tkt_test", "") is None


def test_preview_has_opaque_origin_csp(client, settings):
    root = settings.data_dir / "workspaces" / "ven_test" / "tkt_test" / "dist"
    root.mkdir(parents=True)
    (root / "index.html").write_text("<script>fetch('/v1/ventures')</script>")
    response = client.get("/preview/ven_test/tkt_test/index.html")
    assert response.status_code == 200
    policy = response.headers["content-security-policy"]
    assert "sandbox" in policy and "allow-same-origin" not in policy
    assert "connect-src 'none'" in policy and "form-action 'none'" in policy
