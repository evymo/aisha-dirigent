import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';

export function AdminHeader() {
  const { t } = useTranslation();

  return (
    <header className="flex items-center justify-between border-b border-border bg-[#1A1A1A] px-4 py-3 text-white">
      <div className="flex items-center gap-3">
        <div className="h-6 w-1 rounded-full bg-primary" />
        <span className="text-xs font-semibold uppercase tracking-[0.3em]">{t('admin.sidebar.title')}</span>
      </div>

      <NavLink
        className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        to="/"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{t('admin.sidebar.items.backToSite')}</span>
      </NavLink>
    </header>
  );
}
