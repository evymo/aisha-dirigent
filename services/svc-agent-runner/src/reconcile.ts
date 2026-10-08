import { config } from './config.js';
import { rpcService } from './db.js';
import {
  listManagedContainers,
  killContainer,
  removeRunDir,
  cestyBehu,
} from './backends/claude-cli.js';

interface ReconcileLog {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

/**
 * Boot-time orphan reconciliation. The in-memory RUNNING map is process-local, so
 * after a runner restart (deploy, OOM, Docker restart) any agent container from a
 * previous generation is unowned: `cancel()` can't see it and `AutoRemove:false`
 * means it never self-cleans. Without this, every restart leaks compute, disk
 * (worktrees) AND LLM spend (an orphaned `claude -p` keeps billing the
 * subscription with zero supervision). This runs BEFORE the poller is armed.
 *
 * Every managed container is labeled `aisha.managed_by=svc-agent-runner`, so at
 * boot — when RUNNING is empty — every labeled container is by definition an
 * orphan. We kill it, remove its worktree, finalize its DB row to 'timeout', then
 * prune the worktree registry (also clears the `git worktree add` collision class).
 */
export async function reconcileOrphans(log: ReconcileLog): Promise<number> {
  let reaped = 0;
  let orphans: Array<{ id: string; runId: string }> = [];
  try {
    orphans = await listManagedContainers();
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'orphan reconcile: container list failed');
    return 0;
  }

  for (const { id, runId } of orphans) {
    try {
      await killContainer(id);
      if (runId) {
        // Bez hostitelské cesty (AGENT_RUNS_DIR) nevznikl ani běh — nic k úklidu.
        if (config.agentRunsHostDir) await removeRunDir(cestyBehu(runId).kontejner);
        await rpcService('update_agent_run_status', {
          p_error_summary: 'reconciled orphan on runner restart',
          p_exit_code: -1,
          p_host: config.runnerBackend + '@' + (process.env.HOSTNAME ?? 'unknown'),
          p_run_id: runId,
          p_status: 'timeout',
        }).catch(() => {});
      }
      reaped += 1;
    } catch (err) {
      log.warn({ container: id, runId, error: err instanceof Error ? err.message : String(err) }, 'orphan reconcile: reap failed');
    }
  }

  if (reaped > 0) log.info({ reaped }, 'reconciled orphaned claude_cli_task containers on startup');
  return reaped;
}
