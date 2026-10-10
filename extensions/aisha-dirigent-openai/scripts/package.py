"""Build the reviewed public payload only; credentials and local preview stay out."""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

PUBLIC_FILES = ("plugin.json", "mcp.json", "skills/aisha-dirigent/SKILL.md")
SECRET_KEYS = {"clientsecret", "client_secret", "password", "access_token", "refresh_token", "authorization", "apikey", "api_key"}


def reject_credentials(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in SECRET_KEYS:
                raise ValueError("Credential field is not allowed in the public package")
            reject_credentials(item)
    elif isinstance(value, list):
        for item in value:
            reject_credentials(item)


def https_url(value):
    if not isinstance(value, str):
        raise ValueError("Expected a public HTTPS URL")
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.hostname in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Expected a public HTTPS URL without credentials")


def public_payload(root):
    root = Path(root).resolve()
    payload = {}
    for relative in PUBLIC_FILES:
        path = root / relative
        if any(part.is_symlink() for part in [path, *path.parents] if part != root and root in part.parents):
            raise ValueError("Symlink in public payload")
        if not path.resolve().is_relative_to(root):
            raise ValueError("Path outside plugin root")
        payload[relative] = path.read_bytes()
    manifest = json.loads(payload["plugin.json"])
    mcp = json.loads(payload["mcp.json"])
    reject_credentials(manifest)
    reject_credentials(mcp)
    if manifest.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json":
        raise ValueError("Unsupported manifest schema")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", manifest.get("name", "")) or not re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", "")):
        raise ValueError("Invalid package identity")
    extension = manifest["extensions"]["com.openai"]
    if "hooks" in extension or "hooks" in manifest:
        raise ValueError("Public directory does not accept lifecycle hooks")
    if extension.get("onboardingSkill") != "./skills/aisha-dirigent/SKILL.md":
        raise ValueError("Onboarding skill must be in the payload")
    for key in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        https_url(extension["interface"][key])
    cases = extension["review"]["test_cases"]
    if len(cases["positive"]) < 5 or len(cases["negative"]) < 3:
        raise ValueError("Missing reviewer cases")
    for case in cases["positive"]:
        if not all(isinstance(case.get(key), str) and case[key].strip() for key in ("description", "prompt", "tools_triggered", "expected_behavior")):
            raise ValueError("Incomplete positive reviewer case")
    if mcp.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" or list(mcp.get("mcpServers", {})) != ["aisha"]:
        raise ValueError("Expected one portable MCP server")
    server = mcp["mcpServers"]["aisha"]
    https_url(server["url"])
    if server.get("type") != "streamable-http" or server.get("headers"):
        raise ValueError("Public MCP must use HTTPS without stored headers")
    auth = server["extensions"]["com.openai"]["auth"]
    if auth.get("type") != "oauth" or auth.get("client", {}).get("mode") != "provided" or auth["client"].get("tokenEndpointAuthMethod") != "none" or not auth["client"].get("clientId"):
        raise ValueError("Expected public pre-registered OAuth client")
    skill = payload["skills/aisha-dirigent/SKILL.md"].decode()
    if not skill.startswith("---\nname: aisha-dirigent\ndescription:"):
        raise ValueError("Missing skill identity")
    return payload


def build(root, output):
    payload = public_payload(root)
    output = Path(output).resolve()
    for name in PUBLIC_FILES:
        if output == (Path(root) / name).resolve():
            raise ValueError("Cannot overwrite source with the archive")
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in payload.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return output


def build_codex_preview(root, output):
    """Codex 0.162 supports the legacy OAuth manifest, not portable auth extensions."""
    root, output = Path(root).resolve(), Path(output).resolve()
    if output == root or output in root.parents:
        raise ValueError("Preview output must not replace the plugin source")
    payload = public_payload(root)
    manifest = json.loads(payload["plugin.json"])
    local_mcp = json.loads((root / ".mcp.json").read_text())
    reject_credentials(local_mcp)
    legacy = {key: manifest[key] for key in ("name", "version", "description", "author", "homepage", "repository", "license")}
    legacy["mcpServers"] = "./.mcp.json"
    legacy["interface"] = manifest["extensions"]["com.openai"]["interface"]
    # Local preview is a separate payload; portal auth settings stay in mcp.json.
    legacy["extensions"] = {"com.openai": {"onboardingSkill": "./skills/aisha-dirigent/SKILL.md"}}
    files = {".codex-plugin/plugin.json": (json.dumps(legacy, indent=2) + "\n").encode(),
             ".mcp.json": (json.dumps(local_mcp, indent=2) + "\n").encode(),
             "skills/aisha-dirigent/SKILL.md": payload["skills/aisha-dirigent/SKILL.md"]}
    output.mkdir(parents=True, exist_ok=True)
    if any(path.is_file() and str(path.relative_to(output)) not in files for path in output.rglob("*")):
        raise ValueError("Unexpected file in existing preview; choose a clean output directory")
    for name, content in files.items():
        path = output / name
        if any(part.is_symlink() for part in [path, *path.parents] if part != output and output in part.parents):
            raise ValueError("Symlink in preview output")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--codex-preview", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    print(build(root, args.output))
    if args.codex_preview:
        print(build_codex_preview(root, args.codex_preview))
