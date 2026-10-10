# AISHA Dirigent — OpenAI plugin preview

Connect your AISHA account to project context, expert guidance, assigned work and audited progress in ChatGPT and Codex. Project membership and backend permissions apply to every request. This preview is not yet published in the public directory.

## Build and test

Python 3.10+ is sufficient; the package builder uses only the standard library.

```sh
cd extensions/aisha-dirigent-openai
python3 -m unittest discover -s tests -v
python3 scripts/package.py --output dist/aisha-dirigent-0.1.0.zip --codex-preview dist/codex-preview
```

The reproducible public ZIP contains only `plugin.json`, `mcp.json` and the onboarding skill. It excludes the local preview configuration, identity-provider candidate, build tools, tests and credentials. The publisher must still review both the package and live backend before submission.

## Local Codex preview

Codex CLI 0.162 does not parse portable per-server OpenAI auth extensions. The builder emits a separate legacy-compatible preview under `dist/codex-preview`; the repository marketplace points to that generated directory. Build it before installing:

```sh
codex plugin marketplace add /absolute/path/to/this/repository --json
codex plugin add aisha-dirigent@aisha-preview --json
codex mcp login aisha --scopes openid,email,profile,offline_access
```

The preview uses the existing public PKCE client `aisha-mcp-client` and its exact loopback callback on port 59876. Keep the login command running until it completes. An old callback page will fail after its listener exits; start a fresh login instead of revisiting or sharing the authorization URL. Tokens are held by Codex, never by the plugin files.

Start with `my_next_steps`. Select an explicitly authorized project before requesting its context or recording progress. Read-only hints do not grant permissions, and write actions require the appropriate project and user authorization. Listing automations does not prove they execute.

## Public-directory release requirements

The portable package names a separate public PKCE client, `aisha-openai-plugin`. Identity-provider provisioning is an operator review step and is not included in this public plugin source or ZIP. Keep the local MCP client's loopback redirects unchanged.

Before upload:

1. Review and deploy tool effect annotations and OAuth security metadata through the normal backend release flow. Repeat live `tools/list` verification after deployment; the prepared source change is not proof of live rollout.
2. Obtain the exact callback URI shown by the publisher portal. Review a dedicated PKCE S256 client, resource/audience binding, role scope mappings, refresh limits and gateway client allowlist. Extend the existing MCP-only token isolation to this dedicated client before enabling it: tokens must be denied on unrelated API routes, including the REST/DB exchange path. The current isolation recognizes the local MCP client; adding another allowed client alone is insufficient. Never use a wildcard callback or a shared client secret in the ZIP.
3. Confirm the publishing OpenAI organization and its verification/access. Complete domain ownership verification for the HTTPS MCP endpoint.
4. Provide a reviewer account scoped to a disposable sample project, working test data and a demo walkthrough URL. Exercise the five positive and three negative cases in `plugin.json`, including project isolation and approval behavior. Do not grant global administrator access just for review.
5. Verify the published privacy, terms and support pages, cancellation/relink behavior, expired tokens and the tool-level authentication challenge expected by ChatGPT. Current gateway HTTP 401 discovery is tested; ChatGPT relinking and resource-bound tokens still require an end-to-end test.
6. Submit the reviewed ZIP at [the OpenAI plugin portal](https://platform.openai.com/plugins). Publish only after review approval and the publisher's release decision.

Reference: [packaging](https://developers.openai.com/plugins/build/plugins), [OAuth](https://developers.openai.com/plugins/build/auth), [submission](https://developers.openai.com/plugins/deploy/submission).
