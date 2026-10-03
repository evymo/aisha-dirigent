import { ThemeToggle } from '@aisha/design-language';
import { availableLocales, getLocale, setLocale, t } from '../i18n.js';
import type { SurfaceSection } from '../api.js';

/**
 * The extranet frame: a sidebar of sections and a top bar for the current view.
 * The product design uses the same frame for every surface (workbench, mission
 * control, daily briefing, extranet), so it lives here and not in a view.
 *
 * Everything here is chrome only. WHICH sections exist, what they are called
 * and who may see them is DATA the backend serves — this file must never grow a
 * section name. A new section arrives as a row and appears in the nav on its own.
 */

export type NavSection = SurfaceSection;

/** Section label, key-first with an honest ladder: the template/override key
 *  wins (that is where admin renames land), then the conventional
 *  app.sections.<name> key, then the raw name — a section with no translation
 *  shows itself rather than disappearing. */
export function sectionLabel(section: string, titleKey?: string): string {
  if (titleKey) {
    const viaKey = t(titleKey);
    if (viaKey !== titleKey) return viaKey;
  }
  const key = `app.sections.${section}`;
  const translated = t(key);
  return translated === key ? section : translated;
}

/** Stable grouping: sections keep the backend's order (group_order, position);
 *  ungrouped sections form a single leading group with no label — an instance
 *  without a section template gets exactly the old flat nav. */
function groupSections(sections: NavSection[]): Array<[string | undefined, NavSection[]]> {
  const out: Array<[string | undefined, NavSection[]]> = [];
  for (const s of sections) {
    const last = out[out.length - 1];
    if (last && last[0] === s.group_key) last[1].push(s);
    else out.push([s.group_key, [s]]);
  }
  return out;
}

export function Sidebar({
  sections,
  current,
  onOpen
}: {
  sections: NavSection[];
  current: string;
  onOpen: (section: string) => void;
}): JSX.Element {
  return (
    <aside className="wb-sidebar">
      <div className="wb-sidebar__brand">
        <span className="rdl-brand">{t('app.title')}</span>
        <span className="wb-brand__sub">{t('app.wb.surface')}</span>
      </div>

      <nav className="wb-nav" aria-label={t('app.nav.sections')}>
        {groupSections(sections).map(([groupKey, items]) => (
          <div key={groupKey ?? '_'} className="wb-nav__group">
            {groupKey ? <div className="wb-nav__glabel">{t(groupKey)}</div> : null}
            {items.map((s) => {
              const inactive = s.state === 'inactive';
              return (
                <button
                  key={s.section}
                  className={[
                    'wb-navitem',
                    s.section === current && !inactive ? 'is-active' : '',
                    inactive ? 'is-inactive' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={s.section === current ? 'page' : undefined}
                  /* Muted but OPENABLE. It used to be `disabled`, which locked
                     the reason inside a tooltip no touch device ever shows — so
                     the customer saw a dead item and no explanation. Opening it
                     now leads to the panel that says what it will show and what
                     it waits for. Hidden would read as "unsupported". */
                  aria-disabled={inactive || undefined}
                  title={inactive && s.reason_key ? t(s.reason_key) : undefined}
                  onClick={() => onOpen(s.section)}
                >
                  <span className="wb-navitem__lbl">{sectionLabel(s.section, s.title_key)}</span>
                  {inactive ? null : (
                    <span className="wb-navitem__count rdl-mono">{s.block_count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function TopBar(props: {
  title?: string;
  onLocaleChange: () => void;
  onLogout?: () => void;
  onBack?: () => void;
  preview?: boolean;
  theme: 'carbon' | 'daylight';
  onThemeChange: (theme: 'carbon' | 'daylight') => void;
}): JSX.Element {
  return (
    <header className="wb-topbar">
      <div className="wb-topbar__title">
        {props.onBack ? (
          <button className="rdl-btn rdl-btn--ghost" onClick={props.onBack}>
            ‹ {t('app.wb.back')}
          </button>
        ) : (
          <>
            <span className="rdl-overline">{t('app.title')}</span>
            <span className="wb-topbar__view">{props.title ?? ''}</span>
          </>
        )}
      </div>

      <div className="wb-topbar__actions">
        <ThemeToggle
          value={props.theme}
          onChange={props.onThemeChange}
          ariaLabel={t('app.theme.label')}
        />
        <label className="wb-locale">
          <span className="visually-hidden">{t('app.locale.label')}</span>
          <select
            value={getLocale()}
            onChange={(e) => {
              setLocale(e.target.value);
              props.onLocaleChange();
            }}
          >
            {availableLocales().map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        {props.onLogout ? (
          <button className="rdl-btn rdl-btn--secondary" onClick={props.onLogout}>
            {t('app.logout.cta')}
          </button>
        ) : null}
      </div>
      {props.preview ? <div className="banner preview">{t('app.preview.banner')}</div> : null}
    </header>
  );
}
