/**
 * reachable-endpoint — resolve a host:port the CURRENT process can actually reach
 * for a docker container, robust to the CI runner's DinD model.
 *
 * The problem (proven by the AV lane logs): on this Forgejo DinD runner,
 * `docker run -p 127.0.0.1:HOSTPORT:CONTPORT` publishes the port on the docker
 * DAEMON's host, NOT on the job container's loopback — so the job's
 * `127.0.0.1:HOSTPORT` is unreachable, while the container IS reachable at its
 * bridge IP (e.g. 172.17.x.x) on its IN-CONTAINER port. MinIO even advertised it:
 * `API: http://172.17.x.x:9000  http://127.0.0.1:9000`.
 *
 * Strategy: probe the published 127.0.0.1 endpoint FIRST (works locally and on a
 * bridged DinD — no behaviour change there), then fall back to the container's
 * bridge IP + in-container port (works under the socket-mount / sibling-daemon
 * DinD). Whichever opens a TCP connection first wins. Self-diagnosing: if neither
 * opens within the deadline it returns null (caller dumps logs + fails loud).
 */
import { createConnection } from "node:net";
import { execFileSync, spawnSync } from "node:child_process";
import { hostname } from "node:os";

export function tcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy(); // idempotent + never throws once the socket exists
      resolve(ok);
    };
    const sock = createConnection({ host, port: Number(port) });
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

/** All non-empty container IPs across its docker networks (default-bridge +
 *  any user networks), or [] if it cannot be inspected. The job — a sibling
 *  inside the dind on the default bridge — can reach the default-bridge IP but
 *  not a user-network IP it is not attached to, so we probe every candidate. */
export function containerIps(name) {
  try {
    const out = execFileSync(
      "docker",
      ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", name],
      { encoding: "utf8" },
    );
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

/** The docker networks the CURRENT process's container is attached to. The Forgejo CI
 *  job runs as a dind container on a PER-JOB network (NOT the default bridge), so a
 *  sibling service container started without `--network` lands on the default bridge
 *  and is unreachable from the job (cross-network isolation — verified on soren).
 *  `hostname` is the container id, so `docker inspect $(hostname)` yields the job's
 *  networks. Returns [] when not inside a container (e.g. local Docker Desktop). */
export function jobNetworks() {
  try {
    const out = execFileSync(
      "docker",
      ["inspect", "-f", "{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}", hostname()],
      { encoding: "utf8" },
    );
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Attach a service container to every network the job is on, so the job can reach it
 *  by its IP on a shared network. Best-effort + idempotent (spawnSync never throws on a
 *  non-zero "already connected"); a no-op when jobNetworks() is empty (local runs). */
export function connectToJobNetworks(container) {
  const nets = jobNetworks();
  for (const net of nets) {
    spawnSync("docker", ["network", "connect", net, container], { stdio: "ignore" });
  }
  return nets;
}

/**
 * Resolve a reachable { host, port, via } for a container, polling up to timeoutMs.
 * @param {object} o
 * @param {string} o.container  container name/id (for the bridge-IP fallback)
 * @param {number} o.inPort     the IN-CONTAINER port (e.g. 5432, 9000, 3310)
 * @param {string} [o.host]     published host (default 127.0.0.1)
 * @param {number} o.port       published host port
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{host:string, port:string, via:string}|null>}
 */
export async function resolveReachable({ container, inPort, host = "127.0.0.1", port, timeoutMs = 30000 }) {
  // Share the job's network(s) so a sibling service on the default bridge becomes
  // reachable by its job-network IP (the published 127.0.0.1:port does not bridge).
  connectToJobNetworks(container);
  const t0 = Date.now();
  let ips = [];
  while (Date.now() - t0 < timeoutMs) {
    // Published 127.0.0.1:port first — works locally and on a bridged DinD.
    if (await tcpOpen(host, port)) return { host, port: String(port), via: "published" };
    // Else the container's own IP on its in-container port — works for a job that
    // is a sibling on the same (dind) bridge. Re-read each loop in case networks change.
    ips = containerIps(container);
    for (const ip of ips) {
      if (await tcpOpen(ip, inPort)) return { host: ip, port: String(inPort), via: "container-ip" };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}
