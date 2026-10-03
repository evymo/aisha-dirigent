/**
 * ITokenStorage — platform-agnostic secure token storage interface.
 *
 * Implemented by VscodeTokenStorage (VS Code SecretStorage), or
 * ElectronTokenStorage (Electron safeStorage) for the workbench fork.
 *
 * @module
 */

/** Secure encrypted storage for OAuth tokens. */
export interface ITokenStorage {
  /** Retrieve a stored value. Returns undefined if not set. */
  get(key: string): Promise<string | undefined>;
  /** Store a value securely. */
  store(key: string, value: string): Promise<void>;
  /** Delete a stored value. */
  delete(key: string): Promise<void>;
}
