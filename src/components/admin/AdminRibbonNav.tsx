import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AdminRibbonSubNav } from './AdminRibbonSubNav';
import type { AdminNavGroup } from './adminNavConfig';

interface AdminRibbonNavProps {
  groups: AdminNavGroup[];
}

function isUrlActive(pathname: string, url: string) {
  if (url === '/admin') {
    return pathname === '/admin';
  }
  return pathname.startsWith(url);
}

function getActiveGroup(pathname: string, groups: AdminNavGroup[]): AdminNavGroup | null {
  for (const group of groups) {
    const hasActiveItem = group.items.some((item) => isUrlActive(pathname, item.url));
    if (hasActiveItem) {
      return group;
    }
  }
  return groups[0] ?? null;
}

export function AdminRibbonNav({ groups }: AdminRibbonNavProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const activeGroup = getActiveGroup(location.pathname, groups);

  return (
    <div className="sticky top-0 z-20">
      <div className="border-b border-border bg-[#2A2A2A] px-4 py-2">
        <nav className="flex items-center gap-2 overflow-x-auto">
          {groups.map((group) => {
            const target = group.items[0]?.url ?? '/admin';
            const active = activeGroup?.titleKey === group.titleKey;
            return (
              <NavLink
                key={group.titleKey}
                className={cn(
                  'inline-flex h-10 items-center rounded-md px-4 text-xs font-semibold uppercase tracking-[0.2em] transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-gold-sm'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                )}
                end={target === '/admin'}
                to={target}
              >
                {t(`admin.sidebar.groups.${group.titleKey}`)}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {activeGroup ? <AdminRibbonSubNav group={activeGroup} /> : null}
    </div>
  );
}
