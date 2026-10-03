import { describe, expect, test } from "vitest";
import { jeJmenoSluzby, jeReferenceObrazu, obrazyZCompose, rozvin, sluzbySeStavbou } from "./obrazy-stacku.mjs";

const hodnoty = (o) => (k) => o[k];

describe("rozvin — interpolace jako docker compose", () => {
  test("${VAR}, prázdný prefix a literál", () => {
    expect(rozvin("${REGISTRY_PROXY}library/redis:7-alpine", hodnoty({ REGISTRY_PROXY: "" }))).toBe("library/redis:7-alpine");
    expect(rozvin("${REGISTRY_PROXY}library/redis:7-alpine", hodnoty({ REGISTRY_PROXY: "cache.example/" }))).toBe(
      "cache.example/library/redis:7-alpine",
    );
  });

  test(":- a - se liší u PRÁZDNÉ hodnoty", () => {
    expect(rozvin("${A:-x}", hodnoty({ A: "" }))).toBe("x");
    expect(rozvin("${A-x}", hodnoty({ A: "" }))).toBe("");
    expect(rozvin("${A-x}", hodnoty({}))).toBe("x");
  });

  test(":? bez hodnoty = nerozvinutelné (null), ne prázdný řetězec", () => {
    expect(rozvin("${IMAGE_X:?IMAGE_X must be set}", hodnoty({}))).toBeNull();
    expect(rozvin("${IMAGE_X:?IMAGE_X must be set}", hodnoty({ IMAGE_X: "nginx:1" }))).toBe("nginx:1");
  });

  test("vnořená výchozí hodnota se řeší zevnitř ven", () => {
    expect(rozvin("${IMAGE_RCLONE:-${REGISTRY_PROXY}rclone/rclone:1.68}", hodnoty({ REGISTRY_PROXY: "p/" }))).toBe(
      "p/rclone/rclone:1.68",
    );
  });

  test("$$ je doslovný dolar, $VAR bez závorek se rozvine", () => {
    expect(rozvin("a$$b", hodnoty({}))).toBe("a$b");
    expect(rozvin("$X:1", hodnoty({ X: "img" }))).toBe("img:1");
  });
});

describe("obrazyZCompose — co si stack stáhne", () => {
  const COMPOSE = [
    "services:",
    "  db:",
    "    image: ${IMAGE_POSTGRES:?chybí}",
    "  cache:",
    '    image: "${REGISTRY_PROXY}library/redis:7-alpine"',
    "  web:",
    "    build:",
    "      context: .",
    "  cache2:",
    "    image: ${REGISTRY_PROXY}library/redis:7-alpine",
    "  povinny:",
    "    image: ${IMAGE_CHYBI:?IMAGE_CHYBI must be set}",
  ].join("\n");

  test("rozvine, odstraní uvozovky a duplicitní reference sloučí", () => {
    const r = obrazyZCompose(COMPOSE, hodnoty({ IMAGE_POSTGRES: "pgvector/pgvector:pg17", REGISTRY_PROXY: "" }));
    expect(r.obrazy).toEqual(["pgvector/pgvector:pg17", "library/redis:7-alpine"]);
  });

  test("co rozvinout nejde, se vrací zvlášť — nesmí zmizet jako „nic nestahuje“", () => {
    const r = obrazyZCompose(COMPOSE, hodnoty({ IMAGE_POSTGRES: "pgvector/pgvector:pg17", REGISTRY_PROXY: "" }));
    expect(r.nerozvinute).toEqual(["${IMAGE_CHYBI:?IMAGE_CHYBI must be set}"]);
  });

  test("hodnota, která není referencí obrazu, do vzdáleného příkazu neprojde", () => {
    const r = obrazyZCompose("  x:\n    image: ${ZLE}\n", hodnoty({ ZLE: "nginx; reboot" }));
    expect(r.obrazy).toEqual([]);
    expect(r.nerozvinute).toEqual(["${ZLE}"]);
    expect(jeReferenceObrazu("nginx; reboot")).toBe(false);
    expect(jeReferenceObrazu("ghcr.io/org/img@sha256:abc")).toBe(true);
  });
});

describe("sluzbySeStavbou — co Coolify pro stack staví", () => {
  test("jen služby se `build:`, i přes kotvu `<<: *common`", () => {
    const compose = [
      "x-common: &common",
      "  restart: unless-stopped",
      "services:",
      "  db:",
      "    <<: *common",
      "    image: ${IMAGE_POSTGRES:?chybí}",
      "  web:",
      "    <<: *common",
      "    build:",
      "      context: .",
      "      dockerfile: Dockerfile.web",
      "  pki-init:",
      "    build: ./pki",
    ].join("\n");
    expect(sluzbySeStavbou(compose)).toEqual(["web", "pki-init"]);
  });

  test("stack bez staveb = prázdný seznam, ne null", () => {
    expect(sluzbySeStavbou("services:\n  db:\n    image: postgres:17\n")).toEqual([]);
  });

  test("nečitelný compose = null — nesmí zmizet jako „nic nestaví“", () => {
    expect(sluzbySeStavbou("services: [\n")).toBeNull();
    expect(sluzbySeStavbou("jen: text\n")).toBeNull();
  });

  test("jméno služby, které není bezpečné pro vzdálený příkaz, neprojde", () => {
    expect(sluzbySeStavbou('services:\n  "x; reboot":\n    build: .\n')).toBeNull();
    expect(jeJmenoSluzby("aisha-kronos-shim")).toBe(true);
    expect(jeJmenoSluzby("$(id)")).toBe(false);
  });
});
