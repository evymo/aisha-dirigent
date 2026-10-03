use std::fs;

use zed_extension_api::{self as zed, ContextServerId, Project, Result};

const BUNDLED_BRIDGE_PATH: &str = "server/aisha-mcp-stdio-bridge.mjs";
const MONOREPO_BRIDGE_PATH: &str = "../../server/aisha-mcp-stdio-bridge.mjs";

struct AishaDirigentExtension;

impl AishaDirigentExtension {
    /// Pure path-selection policy, kept separate from the env/filesystem reads in
    /// `bridge_path()` so every branch is deterministically unit-testable.
    ///
    /// Precedence: explicit override → bundled copy (the shipped case) → monorepo
    /// dev fallback → bundled path as a last resort.
    fn resolve_bridge_path(
        override_path: Option<String>,
        bundled_exists: bool,
        monorepo_exists: bool,
    ) -> String {
        if let Some(path) = override_path {
            return path;
        }
        if bundled_exists {
            return BUNDLED_BRIDGE_PATH.to_string();
        }
        if monorepo_exists {
            return MONOREPO_BRIDGE_PATH.to_string();
        }
        BUNDLED_BRIDGE_PATH.to_string()
    }

    fn bridge_path() -> String {
        Self::resolve_bridge_path(
            std::env::var("AISHA_ZED_BRIDGE_PATH").ok(),
            fs::metadata(BUNDLED_BRIDGE_PATH).is_ok(),
            fs::metadata(MONOREPO_BRIDGE_PATH).is_ok(),
        )
    }

    /// Pure command-selection policy (override → default `node`), separated from
    /// the env read so the default is asserted without touching process env.
    fn resolve_node_command(override_command: Option<String>) -> String {
        override_command.unwrap_or_else(|| "node".to_string())
    }

    fn node_command() -> String {
        Self::resolve_node_command(std::env::var("AISHA_ZED_NODE_COMMAND").ok())
    }
}

impl zed::Extension for AishaDirigentExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<zed::Command> {
        let env = vec![
            ("AISHA_IDE_CLIENT".to_string(), "zed".to_string()),
            ("AISHA_ZEDBENCH".to_string(), "1".to_string()),
        ];

        Ok(zed::Command {
            command: Self::node_command(),
            args: vec![Self::bridge_path(), "--stdio".to_string()],
            env,
        })
    }
}

zed::register_extension!(AishaDirigentExtension);

#[cfg(test)]
mod tests {
    use super::*;

    /// The runtime prefers this bundled copy, and the packaging gate asserts a
    /// file exists at exactly this extension-relative path. Keep them in lockstep.
    #[test]
    fn bundled_bridge_path_is_the_relative_launch_target() {
        assert_eq!(BUNDLED_BRIDGE_PATH, "server/aisha-mcp-stdio-bridge.mjs");
        assert!(
            !BUNDLED_BRIDGE_PATH.starts_with('/'),
            "bundled bridge path must be relative to the extension root"
        );
    }

    /// The dev-only fallback must point at the SAME bridge filename, one level
    /// outside the extension (a monorepo checkout), never an absolute path.
    #[test]
    fn monorepo_fallback_targets_the_same_bridge_filename() {
        assert!(MONOREPO_BRIDGE_PATH.ends_with("/aisha-mcp-stdio-bridge.mjs"));
        assert!(MONOREPO_BRIDGE_PATH.starts_with("../"));
    }

    // resolve_bridge_path — every branch, deterministic (no env, no filesystem,
    // no shared-state mutation, so nothing can race under parallel test threads).

    #[test]
    fn explicit_override_wins_over_bundled_and_monorepo() {
        let got = AishaDirigentExtension::resolve_bridge_path(
            Some("/opt/custom/bridge.mjs".to_string()),
            true,
            true,
        );
        assert_eq!(got, "/opt/custom/bridge.mjs");
    }

    #[test]
    fn prefers_bundled_copy_when_present() {
        // The shipped case: a standalone extension resolves its bundled bridge
        // even when a monorepo checkout would also be visible.
        let got = AishaDirigentExtension::resolve_bridge_path(None, true, true);
        assert_eq!(got, BUNDLED_BRIDGE_PATH);
    }

    #[test]
    fn falls_back_to_monorepo_only_in_a_dev_checkout() {
        let got = AishaDirigentExtension::resolve_bridge_path(None, false, true);
        assert_eq!(got, MONOREPO_BRIDGE_PATH);
    }

    #[test]
    fn defaults_to_bundled_path_when_nothing_is_on_disk() {
        let got = AishaDirigentExtension::resolve_bridge_path(None, false, false);
        assert_eq!(got, BUNDLED_BRIDGE_PATH);
    }

    // resolve_node_command — both branches, asserted unconditionally (no ambient
    // env dependency, so coverage never silently evaporates).

    #[test]
    fn node_command_defaults_to_node() {
        assert_eq!(AishaDirigentExtension::resolve_node_command(None), "node");
    }

    #[test]
    fn node_command_honors_override() {
        assert_eq!(
            AishaDirigentExtension::resolve_node_command(Some("nodejs".to_string())),
            "nodejs"
        );
    }
}
