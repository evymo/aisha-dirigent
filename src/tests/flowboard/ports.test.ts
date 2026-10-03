import { describe, it, expect } from "vitest";
import {
  arePortTypesCompatible,
  canConnect,
  type PortSpec,
} from "@/lib/flowboard/ports";

const out = (type: PortSpec["type"]): PortSpec => ({
  id: "o",
  type,
  direction: "out",
  required: false,
  multiple: false,
});
const inp = (type: PortSpec["type"]): PortSpec => ({
  id: "i",
  type,
  direction: "in",
  required: false,
  multiple: false,
});

describe("flowboard/ports", () => {
  it("connects same-type ports", () => {
    expect(arePortTypesCompatible("main", "main")).toBe(true);
    expect(arePortTypesCompatible("ai_tool", "ai_tool")).toBe(true);
  });

  it("lets a trigger or story event start a main chain", () => {
    expect(arePortTypesCompatible("trigger", "main")).toBe(true);
    expect(arePortTypesCompatible("story_event", "main")).toBe(true);
  });

  it("rejects incompatible cross types", () => {
    expect(arePortTypesCompatible("ai_tool", "main")).toBe(false);
    expect(arePortTypesCompatible("main", "ai_languageModel")).toBe(false);
  });

  it("enforces direction (out -> in only)", () => {
    expect(canConnect(out("main"), inp("main"))).toBe(true);
    expect(canConnect(inp("main"), out("main"))).toBe(false);
    expect(canConnect(out("main"), out("main"))).toBe(false);
  });
});
