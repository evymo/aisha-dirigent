import { spawn } from "node:child_process";

const LOCAL_AISHA_GATEWAY_URL = process.env.VITE_AISHA_GATEWAY_URL ?? "http://127.0.0.1:3001";
const LOCAL_AISHA_GATEWAY_KEY =
  process.env.VITE_AISHA_GATEWAY_KEY ??
  process.env.VITE_AISHA_POSTGREST_PUBLISHABLE_KEY ?? "";

const env = {
  ...process.env,
  E2E: "1",
  VITE_E2E: "true",
  VITE_AISHA_GATEWAY_URL: LOCAL_AISHA_GATEWAY_URL,
  VITE_AISHA_GATEWAY_KEY: LOCAL_AISHA_GATEWAY_KEY,
  VITE_AISHA_POSTGREST_URL: LOCAL_AISHA_GATEWAY_URL,
  VITE_AISHA_POSTGREST_ANON_KEY: LOCAL_AISHA_GATEWAY_KEY,
  VITE_AISHA_POSTGREST_PUBLISHABLE_KEY: LOCAL_AISHA_GATEWAY_KEY,
  VITE_KC_URL: process.env.VITE_KC_URL ?? process.env.E2E_KC_URL ?? "http://127.0.0.1:8080",
  VITE_KC_AUTHORITY:
    process.env.VITE_KC_AUTHORITY ?? process.env.E2E_KC_AUTHORITY ?? `http://127.0.0.1:8080/realms/${process.env.KEYCLOAK_REALM ?? "aisha"}`,
  VITE_KC_CLIENT_ID: process.env.VITE_KC_CLIENT_ID ?? process.env.E2E_KC_CLIENT_ID ?? "aisha-app",
};

const vite = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "--host", "0.0.0.0", "--port", "4173", "--strictPort"],
  {
    stdio: "inherit",
    env,
  },
);

vite.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const event of ["SIGINT", "SIGTERM"]) {
  process.on(event, () => {
    vite.kill(event);
  });
}
