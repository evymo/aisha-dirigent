/**
 * Per-user storage OUTSIDE any repository:
 *   <config dir>/profiles.json     — discovered instances (no secrets)
 *   <config dir>/credentials.json  — tokens, mode 0600
 *
 * Config dir: $AISHA_CONFIG_DIR, else %APPDATA%\aisha (Windows),
 * else $XDG_CONFIG_HOME/aisha, else ~/.config/aisha.
 *
 * One login serves every repository on the machine; a repository only gets
 * URLs (`init`), never a token.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STORE_VERSION = 1;

export function configDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.AISHA_CONFIG_DIR) return env.AISHA_CONFIG_DIR;
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "aisha");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "aisha");
}

function readStore(file) {
  if (!existsSync(file)) return { version: STORE_VERSION, profiles: {} };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}) — fix or delete it`);
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.profiles !== "object" || parsed.profiles === null) {
    throw new Error(`${file} has an unexpected shape — fix or delete it`);
  }
  return parsed;
}

/** Atomic replace (tmp + rename) so a concurrent reader never sees half a file. */
function writeStore(dir, file, data, mode) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...data, version: STORE_VERSION }, null, 2) + "\n", { mode });
  if (process.platform !== "win32") chmodSync(tmp, mode);
  renameSync(tmp, file);
}

export function createStore(dir = configDir()) {
  const profilesFile = join(dir, "profiles.json");
  const credentialsFile = join(dir, "credentials.json");
  return {
    dir,
    profilesFile,
    credentialsFile,
    readProfiles: () => readStore(profilesFile),
    writeProfiles: (data) => writeStore(dir, profilesFile, data, 0o644),
    readCredentials: () => readStore(credentialsFile),
    writeCredentials: (data) => writeStore(dir, credentialsFile, data, 0o600),

    getProfile(name) {
      return this.readProfiles().profiles[name] ?? null;
    },
    saveProfile(name, profile, { makeDefault = false } = {}) {
      const data = this.readProfiles();
      data.profiles[name] = profile;
      if (makeDefault || !data.defaultProfile) data.defaultProfile = name;
      this.writeProfiles(data);
    },
    getCredential(name) {
      return this.readCredentials().profiles[name] ?? null;
    },
    saveCredential(name, credential) {
      const data = this.readCredentials();
      data.profiles[name] = credential;
      this.writeCredentials(data);
    },
    deleteCredential(name) {
      const data = this.readCredentials();
      const existed = Boolean(data.profiles[name]);
      delete data.profiles[name];
      this.writeCredentials(data);
      return existed;
    },
  };
}
