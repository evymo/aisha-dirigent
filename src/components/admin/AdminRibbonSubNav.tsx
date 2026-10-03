import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { AdminNavGroup } from './adminNavConfig';

interface AdminRibbonSubNavProps {
  group: AdminNavGroup;
}

function isItemActive(pathname: string, url: string) {
  if (url === '/admin') {
    return pathname === '/admin';
  }
  return pathname.startsWith(url);
}

export function AdminRibbonSubNav({ group }: AdminRibbonSubNavProps) {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="border-b border-border bg-background px-4 py-2">
      <nav className="flex items-center gap-1 overflow-x-auto">
        {group.items.map((item) => {
          const active = isItemActive(location.pathname, item.url);
          return (
            <NavLink
              key={item.url}
              className={cn(
                'inline-flex h-9 items-center rounded-md px-3 text-xs font-semibold uppercase tracking-[0.08em] transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-gold-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
              end={item.url === '/admin'}
              to={item.url}
            >
              {item.labelKey ? t(item.labelKey) : t(`admin.sidebar.items.${item.titleKey}`)}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
