import { describe, expect, test } from "vitest";
import { cilTcpTrasy, devEnvDefaults } from "../../config/local-presets.mjs";

describe("cilTcpTrasy (lokálně rovnou na cíl TCP mesh trasy)", () => {
  test("vrátí hostitele cíle pro daný port, i z exportu v uvozovkách", () => {
    expect(cilTcpTrasy("'5672|p-integration--rabbitmq:5672'", 5672)).toBe("p-integration--rabbitmq");
    expect(cilTcpTrasy("5672|a:5672;6379|b-redis:6379", 6379)).toBe("b-redis");
  });

  test("chybějící trasa → prázdný řetězec (compose `:?` to řekne nahlas), žádné dosazení", () => {
    expect(cilTcpTrasy("", 5672)).toBe("");
    expect(cilTcpTrasy(undefined, 5672)).toBe("");
    expect(cilTcpTrasy("6379|b:6379", 5672)).toBe("");
  });

  test("lokální RABBITMQ_HOST je cíl trasy z derivace (alias kontejneru RabbitMQ)", () => {
    expect(devEnvDefaults.RABBITMQ_HOST).toMatch(/^[a-z0-9-]+-integration--rabbitmq$/);
  });
});
