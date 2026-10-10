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

    def test_cannot_overwrite_manifest(self):
        with self.assertRaisesRegex(ValueError, "overwrite"):
            package.build(self.root, self.root / "plugin.json")


if __name__ == "__main__":
    unittest.main()
