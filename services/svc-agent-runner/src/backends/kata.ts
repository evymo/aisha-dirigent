import type { RunInput, RunResult, RunnerBackend } from './index.js';
import { config } from '../config.js';
import { runSandboxContainer } from './sandbox-run.js';

// Kata Containers runs as a Docker-compatible runtime via containerd shim.
// The Docker socket is the same — only RuntimeClass differs ('kata-fc' for Firecracker).
// This allows sandboxed VM-level isolation without a separate gRPC CRI client.

/**
 * Map AISHA execution profile to containerd Runtime name.
 * - 'kata-firecracker' → 'kata-fc' (Firecracker VMM, ~100ms cold start, sealed/stateless)
 * - 'kata-dragonball' → 'kata-dragonball' (DragonBall VMM, container-native, workspace-friendly)
 * Falls back to config default or 'kata-fc'.
 */
function runtimeFromProfile(profile: string | undefined): string {
  if (profile === 'kata-firecracker') return 'kata-fc';
  if (profile === 'kata-dragonball') return 'kata-dragonball';
  return config.kataGrpcEndpoint || 'kata-fc';
}

export class KataBackend implements RunnerBackend {
  async execute(input: RunInput): Promise<RunResult> {
    if (!config.dockerSocket) {
      throw new Error('Kata backend requires DOCKER_SOCKET (containerd-backed Docker daemon with kata-fc runtime).');
    }
    // Týž požadavek na kontejner jako DockerBackend (kořen jen pro čtení, CapDrop ALL,
    // PidsLimit, uživatel, jen síť běhů) — liší se jen runtime VM. Dřív kata skládala
    // vlastní kopii BEZ kořene jen pro čtení a bez CapDrop („spoléhá na VM“).
    return runSandboxContainer(input, {
      runtime: runtimeFromProfile(input.profile),
      hostLabel: 'kata',
      timeoutLabel: 'Kata container',
    });
  }
}
