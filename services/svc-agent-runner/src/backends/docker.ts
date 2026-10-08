import type { RunInput, RunResult, RunnerBackend } from './index.js';
import { runSandboxContainer } from './sandbox-run.js';

/**
 * Běh pluginu v runc kontejneru. Požadavek na kontejner, síť běhů a cestu k brokeru
 * skládá sandbox-run.ts (společně s Kata) — viz tam.
 */
export class DockerBackend implements RunnerBackend {
  async execute(input: RunInput): Promise<RunResult> {
    return runSandboxContainer(input, { hostLabel: 'docker', timeoutLabel: 'Container' });
  }
}
