# Appsmith Widget Catalog

Re-použitelné widget JSON templates pro `WF_APPSMITH_DASHBOARD_BUILDER`.

Každý widget je parametrizován Mustache-style placeholdery (`{{title}}`, `{{query_name}}`, …),
které builder vyplní podle discovered observability sources.

## Použití

```javascript
import { readFileSync } from 'fs';
import Mustache from 'mustache';

const template = JSON.parse(readFileSync('appsmith/widgets/table.json', 'utf8'));
const rendered = JSON.parse(Mustache.render(JSON.stringify(template), {
  widgetId: 'widget-overview-table-bg-switches',
  title: 'Recent B/G Switches',
  query_name: 'getRecentBGSwitches',
  columns_json: '[{ "Header": "App", "accessor": "app_name" }, ...]',
}));
```

## Widget templates

| Soubor | Účel | Klíčové placeholdery |
|---|---|---|
| `statbox.json` | Číselná metrika s label | `{{widgetId}}`, `{{title}}`, `{{value_query}}`, `{{label}}`, `{{color}}`, `{{position}}` |
| `table.json` | Tabulka z RPC výsledků | `{{widgetId}}`, `{{title}}`, `{{query_name}}`, `{{columns_json}}`, `{{position}}` |
| `chart-line.json` | Časová řada (line chart) | `{{widgetId}}`, `{{title}}`, `{{query_name}}`, `{{x_field}}`, `{{y_field}}` |
| `chart-bar.json` | Bar chart | `{{widgetId}}`, `{{title}}`, `{{query_name}}`, `{{x_field}}`, `{{y_field}}` |
| `iframe.json` | Embedded UI (Sentry, Langfuse, Dozzle) | `{{widgetId}}`, `{{src_url}}`, `{{height}}` |
| `button.json` | Action button (admin only) | `{{widgetId}}`, `{{label}}`, `{{webhook_url}}`, `{{role_required}}`, `{{confirm_message}}` |
| `text-status.json` | Status indicator s color mapping | `{{widgetId}}`, `{{label}}`, `{{value}}`, `{{status_map_json}}` |

## Convention

- **Widget IDs**: deterministic `widget-{section}-{kind}-{source-slug}`. Builder generuje
  podle layout grid + zdroje. Stejný source → stejný ID → idempotent re-import.
- **Position**: `{{position}}` placeholder vyplní builder podle layout grid pravidel.
- **Datasource**: queries reference `{{query_name}}` který musí být registrované v dashboard
  template's `pageWidgets[].pageActions[]`.

## Bezpečnost

Action buttons (`button.json`) MUSÍ mít:
- `dynamicHidden: "{{ !appsmith.user.roles?.includes(role_required) }}"` — UI hide
- Webhook handler **dvojitě** validuje role (bezpečnostní gate, ne jen UX)
