/**
 * Admin Model Switch — runtime AI model override z Dirigent extenze.
 *
 * Příkaz `aisha.dirigent.switchAdminModel` zobrazí QuickPick s AI modely
 * z `ai_model_registry` (filtered přes `list_ai_models_admin` RPC, admin/staff
 * JWT only) a po výběru aktivuje override přes `set_active_ai_model_admin`
 * RPC (audit-traced v audit_journal).
 *
 * AISHA principy:
 *  - Permission gating na backend (RPC kontroluje is_admin_or_staff).
 *  - Audit trail (každá změna do audit_journal s metadata = ID + state).
 *  - Žádný paralelní registry — vše přes existující `ai_model_registry` table.
 *
 * @module
 */

import * as vscode from 'vscode';
import { callRpc } from './backend-rpc';
import { safeError, safeInfo } from './safe-logger';

interface ModelEntry {
  id: string;
  provider: string;
  model_id: string;
  display_name: string | null;
  is_admin_active: boolean;
  is_available: boolean;
  is_deprecated: boolean;
  context_window: number | null;
  input_price_per_m: number | null;
  output_price_per_m: number | null;
  eval_status: string | null;
  latest_eval_score: number | null;
}

interface SetActiveResponse {
  ok: boolean;
  provider: string;
  model_id: string;
  is_admin_active: boolean;
  previous_state?: boolean;
}

function formatPrice(p: number | null): string {
  if (p === null || p === undefined) return '–';
  return `$${p.toFixed(2)}/M`;
}

function buildPickItem(model: ModelEntry): vscode.QuickPickItem & { model: ModelEntry } {
  const label = model.display_name ?? `${model.provider}/${model.model_id}`;
  const ctx = model.context_window ? `ctx: ${(model.context_window / 1000).toFixed(0)}K` : '';
  const price = `in: ${formatPrice(model.input_price_per_m)} · out: ${formatPrice(model.output_price_per_m)}`;
  const detail = [ctx, price, model.eval_status ?? ''].filter(Boolean).join(' · ');
  const description = model.is_admin_active
    ? '★ active override'
    : model.is_deprecated
    ? '⚠ deprecated'
    : model.provider;
  return {
    label,
    description,
    detail,
    model,
  };
}

/**
 * Register `aisha.dirigent.switchAdminModel` command.
 */
export function registerAdminModelSwitch(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('aisha.dirigent.switchAdminModel', async () => {
      // 1) Fetch list (admin-only RPC; backend returns 403 for non-admin).
      const { data } = await callRpc<ModelEntry[]>('list_ai_models_admin', {
        p_provider: null,
        p_only_available: true,
      });

      if (!data || !Array.isArray(data)) {
        vscode.window.showErrorMessage(
          'AISHA Dirigent: model registry unavailable (admin/staff role required, nebo backend offline).',
        );
        return;
      }

      if (data.length === 0) {
        vscode.window.showInformationMessage('AISHA Dirigent: no models in registry.');
        return;
      }

      // 2) Show QuickPick.
      const items = data.map(buildPickItem);
      const picked = await vscode.window.showQuickPick(items, {
        title: 'AISHA — Switch Active AI Model (admin override)',
        placeHolder: 'Vyberte model (★ označuje aktuálně aktivní override)',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!picked) return;

      // 3) Toggle: pokud je už aktivní → deactivate, jinak activate.
      const newState = !picked.model.is_admin_active;

      const confirm = await vscode.window.showInformationMessage(
        newState
          ? `Aktivovat model ${picked.label} jako admin override?`
          : `Deaktivovat admin override pro ${picked.label}?`,
        { modal: false },
        'Potvrdit',
        'Zrušit',
      );

      if (confirm !== 'Potvrdit') return;

      // 4) Call RPC.
      const result = await callRpc<SetActiveResponse>('set_active_ai_model_admin', {
        p_provider: picked.model.provider,
        p_model_id: picked.model.model_id,
        p_is_active: newState,
      });

      if (!result.data || !result.data.ok) {
        safeError(
          'admin-model-switch',
          `Failed for ${picked.model.provider}/${picked.model.model_id}`,
        );
        vscode.window.showErrorMessage(
          'AISHA Dirigent: změna modelu selhala (admin/staff role required, nebo audit log nedostupný).',
        );
        return;
      }

      safeInfo(
        'admin-model-switch',
        `Override ${result.data.is_admin_active ? 'enabled' : 'disabled'} for ${result.data.provider}/${result.data.model_id}`,
      );

      vscode.window.showInformationMessage(
        result.data.is_admin_active
          ? `✓ Aktivován ${picked.label} jako admin override`
          : `✓ Deaktivován admin override pro ${picked.label}`,
      );
    }),
  );
}
