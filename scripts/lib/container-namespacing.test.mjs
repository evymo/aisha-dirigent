import { describe, expect, test } from "vitest";
import { collapseToLocalNetwork } from "./container-namespacing.mjs";

describe("collapseToLocalNetwork", () => {
  test("keeps aliases declared on any source network (n8n--main answers as <prefix>-n8n)", () => {
    const networks = {
      internal: { aliases: ["local-n8n"] },
      "mesh-dns": { aliases: ["local-n8n"] },
    };
    expect(collapseToLocalNetwork(networks, "aisha-local")).toEqual({
      "aisha-local": { aliases: ["local-n8n"] },
    });
  });

  test("unions distinct aliases across networks in declaration order", () => {
    const networks = { a: { aliases: ["x", "y"] }, b: { aliases: ["y", "z"] }, c: null };
    expect(collapseToLocalNetwork(networks, "net")).toEqual({ net: { aliases: ["x", "y", "z"] } });
  });

  test("no declared aliases → bare local network", () => {
    expect(collapseToLocalNetwork({ internal: null, "mesh-dns": {} }, "net")).toEqual({ net: null });
  });

  test("list form collapses to the local network only", () => {
    expect(collapseToLocalNetwork(["internal", "mesh-dns"], "net")).toEqual(["net"]);
  });

  test("does not mutate its input", () => {
    const networks = { internal: { aliases: ["a"] } };
    collapseToLocalNetwork(networks, "net");
    expect(networks).toEqual({ internal: { aliases: ["a"] } });
  });
});

describe("namespaceContainerNames — alias set", () => {
  test("a source alias equal to the original container name is not listed twice", async () => {
    const { namespaceContainerNames } = await import("./container-namespacing.mjs");
    const { LOCAL_STACK } = await import("./local-stack-name.mjs");
    const doc = {
      services: {
        db: { container_name: "local-db", networks: { [LOCAL_STACK]: { aliases: ["local-db"] } } },
      },
    };
    namespaceContainerNames(doc, `${LOCAL_STACK}__`);
    expect(doc.services.db.container_name).toBe(`${LOCAL_STACK}__local-db`);
    expect(doc.services.db.networks[LOCAL_STACK].aliases).toEqual(["local-db"]);
  });
});
