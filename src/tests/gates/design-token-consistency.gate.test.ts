/**
 * Design Token Consistency Gate Test
 *
 * Validates the AISHA brand design-token pipeline:
 *   1. packages/design-tokens/tokens.json is valid + complete — the committed
 *      in-stack mirror of the canonical brand (orange #FF6A1A, Nunito Sans, the
 *      editorial near-black canvas + skew slice; see tokens.json $meta).
 *   2. The generated consumer artifacts build cleanly and reflect tokens.json:
 *        dist/aisha.css          (web + workbench webviews)
 *        dist/aisha-theme.ts     (mobile-app / React Native)
 *        dist/vscode-colors.json (workbench chrome)
 *
 * NOTE: rewritten from an earlier Material-3 token schema that the design-tokens
 * package no longer implements — it now mirrors the REAL brand (see build.mjs +
 * tokens.json). "Obsoleted-by-stack-change = rewrite, not delete."
 *
 * Run:
 *   npx vitest run -c vitest.gates.config.ts src/tests/gates/design-token-consistency.gate.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(__dirname, "../../..");
const PKG = path.join(ROOT, "packages/design-tokens");
const TOKENS_PATH = path.join(PKG, "tokens.json");
const CSS_PATH = path.join(PKG, "dist/aisha.css");
const TS_PATH = path.join(PKG, "dist/aisha-theme.ts");
const VSCODE_PATH = path.join(PKG, "dist/vscode-colors.json");

function loadTokens() {
    if (!fs.existsSync(TOKENS_PATH)) {
        throw new Error(`tokens.json not found at ${TOKENS_PATH}`);
    }
    return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
}

describe("Design Token — tokens.json validity", () => {
    const tokens = loadTokens();

    it("contains all required top-level groups", () => {
        const requiredKeys = ["color", "alpha", "font", "type", "tracking", "radius", "space", "motion", "skew"];
        for (const key of requiredKeys) {
            expect(tokens, `tokens.json missing "${key}"`).toHaveProperty(key);
        }
    });

    it("color has the core brand + semantic roles", () => {
        const requiredColors = ["primary", "primaryDark", "white", "black", "bg0", "bg1", "success", "warning", "error", "info"];
        for (const role of requiredColors) {
            expect(tokens.color, `color missing "${role}"`).toHaveProperty(role);
        }
    });

    it("color values are valid hex", () => {
        const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
        for (const [k, value] of Object.entries(tokens.color)) {
            expect(value, `color "${k}" should be a hex value`).toMatch(hex);
        }
    });

    it("font defines the brand family roles", () => {
        const roles = ["black", "medium", "roman", "book", "mono"];
        for (const r of roles) {
            expect(tokens.font, `font missing "${r}"`).toHaveProperty(r);
        }
    });

    it("type scale + line-height base are present", () => {
        for (const k of ["xs", "sm", "md", "lg", "xl"]) {
            expect(tokens.type, `type missing "${k}"`).toHaveProperty(k);
        }
        expect(tokens.type).toHaveProperty("lineHeightBase");
    });

    it("radius + space scales are non-empty", () => {
        expect(Object.keys(tokens.radius).length).toBeGreaterThan(0);
        expect(Object.keys(tokens.space).length).toBeGreaterThan(0);
        expect(tokens.radius).toHaveProperty("md");
    });

    it("motion has a default easing + named durations", () => {
        expect(tokens.motion).toHaveProperty("easeDefault");
        for (const d of ["fast", "base", "slow"]) {
            expect(tokens.motion, `motion missing duration "${d}"`).toHaveProperty(d);
        }
    });

    it("skew angles present (signature editorial slice)", () => {
        expect(tokens.skew).toHaveProperty("angle");
    });
});

describe("Design Token — generated artifacts are up-to-date", () => {
    let css = "";
    let ts = "";
    let vscode = "";

    beforeAll(() => {
        // Always regenerate so the gate validates the CURRENT tokens.json
        // (dist/ is build output, not committed).
        execSync("node packages/design-tokens/build.mjs", { cwd: ROOT, stdio: "pipe" });
        css = fs.readFileSync(CSS_PATH, "utf-8");
        ts = fs.readFileSync(TS_PATH, "utf-8");
        vscode = fs.readFileSync(VSCODE_PATH, "utf-8");
    });

    it("dist/aisha.css exists with auto-generated header + :root block", () => {
        expect(fs.existsSync(CSS_PATH)).toBe(true);
        expect(css).toContain("AUTO-GENERATED");
        expect(css).toContain(":root {");
    });

    it("dist/aisha-theme.ts exists with auto-generated header", () => {
        expect(fs.existsSync(TS_PATH)).toBe(true);
        expect(ts).toContain("AUTO-GENERATED");
    });

    it("dist/vscode-colors.json exists with workbench customizations", () => {
        expect(fs.existsSync(VSCODE_PATH)).toBe(true);
        const parsed = JSON.parse(vscode);
        expect(parsed).toHaveProperty("workbench.colorCustomizations");
    });

    it("CSS exposes brand custom properties derived from tokens.json", () => {
        const tokens = loadTokens();
        for (const v of ["--color-primary:", "--font-black:", "--radius-md:", "--space-1:", "--ember-bg:"]) {
            expect(css, `CSS should contain ${v}`).toContain(v);
        }
        // the primary brand colour flows through verbatim (SoT → generated)
        expect(css).toContain(`--color-primary: ${tokens.color.primary}`);
    });

    it("RN theme exports the per-group brand constants", () => {
        for (const exp of ["aishaColors", "aishaFont", "aishaType", "aishaRadius", "aishaSpace", "aishaMotion", "aishaSkew"]) {
            expect(ts, `RN theme should export ${exp}`).toContain(`export const ${exp}`);
        }
    });

    it("RN theme constants are typed `as const`", () => {
        expect(ts).toContain("as const;");
    });

    it("VSCode chrome maps the brand primary onto activity bar + buttons", () => {
        const tokens = loadTokens();
        const parsed = JSON.parse(vscode);
        const colors = parsed["workbench.colorCustomizations"];
        expect(colors["activityBar.foreground"]).toBe(tokens.color.primary);
        expect(colors["button.background"]).toBe(tokens.color.primary);
    });
});
