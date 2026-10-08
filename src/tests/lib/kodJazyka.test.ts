import { describe, expect, it } from "vitest";
import { jeKodJazyka } from "@/lib/i18n/kodJazyka";

describe("jeKodJazyka", () => {
  it.each([
    ["cs", true], ["en", true], ["pt-BR", true], ["EN", true],
    ["global", false], ["c", false], ["ces", false], ["pt-BR-x", false], ["", false], ["pt-", false],
  ])("%s → %s", (kod, ocekavano) => {
    expect(jeKodJazyka(kod)).toBe(ocekavano);
  });
});
