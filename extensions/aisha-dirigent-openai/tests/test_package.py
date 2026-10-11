import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("aisha_plugin_package", ROOT / "scripts/package.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "plugin"
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns("dist", "__pycache__"))

    def tearDown(self):
        self.temp.cleanup()

    def edit(self, file, mutate):
        path = self.root / file
        data = json.loads(path.read_text())
        mutate(data)
        path.write_text(json.dumps(data))

    def test_archive_is_reproducible_and_excludes_local_credentials_and_client_candidate(self):
        (self.root / ".env").write_text("SECRET=not-for-upload")
        a = package.build(self.root, Path(self.temp.name) / "a.zip")
        b = package.build(self.root, Path(self.temp.name) / "b.zip")
        self.assertEqual(a.read_bytes(), b.read_bytes())
        with ZipFile(a) as z:
            self.assertEqual(z.namelist(), list(package.PUBLIC_FILES))
            self.assertIsNone(z.testzip())

    def test_standalone_archive_contains_complete_canonical_license(self):
        archive = package.build(self.root, Path(self.temp.name) / "licensed.zip")
        with ZipFile(archive) as zipped:
            self.assertIn("LICENSE", zipped.namelist())
            self.assertEqual(zipped.read("LICENSE"), (ROOT.parents[1] / "LICENSE").read_bytes())

    def test_codex_preview_contains_complete_canonical_license(self):
        directory = package.build_codex_preview(self.root, Path(self.temp.name) / "licensed-preview")
        self.assertEqual((directory / "LICENSE").read_bytes(), (ROOT.parents[1] / "LICENSE").read_bytes())

    def test_both_distributed_source_folders_preserve_canonical_license_and_identity(self):
        canonical = (ROOT.parents[1] / "LICENSE").read_bytes()
        for folder, manifest_path in ((ROOT, "plugin.json"),
                                     (ROOT.parent / "aisha-dirigent-claude-cloud", ".claude-plugin/plugin.json")):
            with self.subTest(folder=folder.name):
                self.assertEqual((folder / "LICENSE").read_bytes(), canonical)
                manifest = json.loads((folder / manifest_path).read_text())
                self.assertEqual(manifest["license"], "Elastic-2.0")
                self.assertEqual(manifest["name"], "aisha-dirigent")
                self.assertEqual(manifest["version"], "0.1.0")

    def test_missing_license_prevents_distribution(self):
        (self.root / "LICENSE").unlink(missing_ok=True)
        for builder, destination in ((package.build, "missing-license.zip"),
                                     (package.build_codex_preview, "missing-license-preview")):
            with self.subTest(builder=builder.__name__):
                with self.assertRaises(FileNotFoundError):
                    builder(self.root, Path(self.temp.name) / destination)
                self.assertFalse((Path(self.temp.name) / destination).exists())

    def test_codex_preview_uses_legacy_loopback_oauth_without_portal_settings(self):
        directory = package.build_codex_preview(self.root, Path(self.temp.name) / "preview")
        self.assertFalse((directory / "mcp.json").exists())
        config = json.loads((directory / ".mcp.json").read_text())
        server = config["mcpServers"]["aisha"]
        self.assertEqual(server["oauth"]["clientId"], "aisha-mcp-client")
        self.assertEqual(server["oauth"]["callbackPort"], 59876)
        self.assertNotIn("extensions", server)
        self.assertTrue((directory / ".codex-plugin/plugin.json").is_file())

    def test_preview_does_not_replace_source_or_follow_output_symlinks(self):
        with self.assertRaisesRegex(ValueError, "replace"):
            package.build_codex_preview(self.root, self.root)
        directory = Path(self.temp.name) / "preview"
        directory.mkdir()
        (directory / "skills").symlink_to(self.root / "skills", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            package.build_codex_preview(self.root, directory)

    def test_rejects_credential_in_manifest(self):
        self.edit("mcp.json", lambda j: j["mcpServers"]["aisha"].update({"headers": {"Authorization": "Bearer fake-test"}}))
        with self.assertRaisesRegex(ValueError, "Credential"):
            package.public_payload(self.root)

    def test_rejects_non_secret_static_headers_too(self):
        self.edit("mcp.json", lambda j: j["mcpServers"]["aisha"].update({"headers": {"X-User": "fake-test"}}))
        with self.assertRaisesRegex(ValueError, "stored headers"):
            package.public_payload(self.root)

    def test_rejects_local_or_credentialed_remote_server(self):
        for url in ("http://localhost:3001/mcp", "https://user:password@example.test/mcp"):
            self.edit("mcp.json", lambda j: j["mcpServers"]["aisha"].update({"url": url}))
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                package.public_payload(self.root)

    def test_rejects_missing_review_case(self):
        self.edit("plugin.json", lambda j: j["extensions"]["com.openai"]["review"]["test_cases"]["positive"].pop())
        with self.assertRaisesRegex(ValueError, "reviewer"):
            package.public_payload(self.root)

    def test_rejects_hooks_for_public_directory(self):
        self.edit("plugin.json", lambda j: j["extensions"]["com.openai"].update({"hooks": "./hooks.json"}))
        with self.assertRaisesRegex(ValueError, "hooks"):
            package.public_payload(self.root)

    def test_rejects_skill_path_escape(self):
        self.edit("plugin.json", lambda j: j["extensions"]["com.openai"].update({"onboardingSkill": "../secret.md"}))
        with self.assertRaisesRegex(ValueError, "skill"):
            package.public_payload(self.root)

    def test_rejects_symlink_even_when_it_points_inside_root(self):
        path = self.root / "skills/aisha-dirigent/SKILL.md"
        target = self.root / "saved-skill.md"
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            package.public_payload(self.root)

    def test_portal_identity_override_does_not_change_source_or_display_name(self):
        name = "app-69cc2f10efec8191b84de34ea25260af"
        source = (self.root / "plugin.json").read_bytes()
        archive = package.build(self.root, Path(self.temp.name) / "portal.zip", name)
        with ZipFile(archive) as z:
            manifest = json.loads(z.read("plugin.json"))
            self.assertEqual(manifest["name"], name)
            self.assertEqual(manifest["extensions"]["com.openai"]["interface"]["displayName"], "AISHA Dirigent")
        self.assertEqual((self.root / "plugin.json").read_bytes(), source)

    def test_rejects_invalid_portal_identity(self):
        for name in ("../escape", "AISHA", "", "bad_name"):
            with self.assertRaisesRegex(ValueError, "portal"):
                package.build(self.root, Path(self.temp.name) / "bad.zip", name)

    def test_requires_both_bundled_icons(self):
        self.edit("plugin.json", lambda j: j["extensions"]["com.openai"]["interface"].pop("logo"))
        with self.assertRaisesRegex(ValueError, "icons"):
            package.public_payload(self.root)

    def test_rejects_malformed_or_non_square_icon(self):
        path = self.root / "assets/icon.png"
        original = path.read_bytes()
        for data in (b"invalid", original[:16] + (256).to_bytes(4, "big") + (128).to_bytes(4, "big") + original[24:]):
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "icon|Icon"):
                package.public_payload(self.root)

    def test_preview_includes_referenced_visual_asset(self):
        directory = package.build_codex_preview(self.root, Path(self.temp.name) / "preview")
        self.assertEqual((directory / "assets/icon.png").read_bytes(), (self.root / "assets/icon.png").read_bytes())

    def test_cannot_overwrite_manifest(self):
        with self.assertRaisesRegex(ValueError, "overwrite"):
            package.build(self.root, self.root / "plugin.json")


if __name__ == "__main__":
    unittest.main()
