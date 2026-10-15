import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, Layers3 } from 'lucide-react';
import { cn } from '../ui/utils/cn';
import { resolveNavIcon } from './nav-icons';
import { isNavItemVisible, useNavAccess } from './useNavAccess';
import { SHELL_NAV_GROUPS } from './nav-config';

type ShellNavListProps = {
  onNavigate?: () => void;
  alertCount?: number;
  alertsLoading?: boolean;
  theme?: 'dark' | 'light';
};

/** Process navigator: choose a business area, then its authorised work surfaces. */
export function ShellNavList({
  onNavigate,
  alertCount = 0,
  alertsLoading = false,
  theme = 'dark',
}: ShellNavListProps) {
  const { loading, access } = useNavAccess();
  const { pathname } = useLocation();
  const [choice, setChoice] = useState<{ path: string; id: string } | null>(null);
  const groups = SHELL_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isNavItemVisible(item.id, access, loading)),
  })).filter((group) => group.items.length > 0);
  const current = groups
    .flatMap((group) => group.items.map((item) => ({ group, item })))
    .filter(
      ({ item }) =>
        pathname === item.path || (item.path !== '/app' && pathname.startsWith(`${item.path}/`)),
    )
    .sort((a, b) => b.item.path.length - a.item.path.length)[0]?.group;
  const selected =
    groups.find((group) => group.id === (choice?.path === pathname ? choice.id : current?.id)) ??
    groups[0];

  return (
    <nav
      className={cn(
        'sidebar-scroll flex min-h-0 flex-1 flex-col overflow-y-auto',
        theme === 'dark' ? 'text-[var(--color-on-shell-nav)]' : 'bg-white text-[var(--erp-text)]',
      )}
      aria-label="Navegação principal"
    >
      {loading ? (
        <p className="px-3 py-2 text-xs" aria-live="polite">
          Carregando navegação…
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-[3.25rem_minmax(0,1fr)]">
        <div
          className="flex flex-col items-center gap-1 border-r border-[var(--color-shell-border)] bg-black/15 py-3"
          role="group"
          aria-label="Processos de negócio"
        >
          {groups.map((group) => {
            const Icon = resolveNavIcon(group.items[0]?.id ?? 'home');
            return (
              <button
                key={group.id}
                type="button"
                title={group.label}
                aria-label={group.label}
                aria-pressed={selected?.id === group.id}
                onClick={() => setChoice({ path: pathname, id: group.id })}
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-blue-400',
                  selected?.id === group.id
                    ? 'bg-brand-600 text-white'
                    : 'text-[var(--color-on-shell-muted)] hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon className="size-[18px]" aria-hidden="true" focusable={false} />
              </button>
            );
          })}
        </div>
        <div className="min-w-0 px-2 py-3">
          {selected ? (
            <section aria-label={selected.label}>
              <div className="mb-4 px-2">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-[.16em] text-[var(--color-on-shell-dim)]">
                  Área de trabalho
                </p>
                <h2 className="m-0 text-sm font-semibold leading-tight">{selected.label}</h2>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {selected.items.map((item) => {
                  const Icon = resolveNavIcon(item.id);
                  return (
                    <li key={item.id}>
                      <NavLink
                        to={item.path}
                        end={item.path === '/app' || item.id === 'finance-overview'}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            'group flex min-h-9 items-center gap-2 rounded px-2 py-1.5 text-xs no-underline focus-visible:outline-2 focus-visible:outline-blue-400',
                            isActive
                              ? 'bg-[var(--color-shell-active)] font-semibold text-white'
                              : 'hover:bg-[var(--color-shell-hover)]',
                          )
                        }
                      >
                        <Icon
                          className="size-4 shrink-0 opacity-70"
                          aria-hidden="true"
                          focusable={false}
                        />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {item.id === 'alerts' && !alertsLoading && alertCount > 0 ? (
                          <span className="text-xs text-red-300">
                            {alertCount > 99 ? '99+' : alertCount}
                          </span>
                        ) : null}
                        <ChevronRight className="size-3 shrink-0 opacity-40" aria-hidden />
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <div className="mt-6 border-t border-[var(--color-shell-border)] pt-3">
            <p className="px-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[var(--color-on-shell-dim)]">
              Cadeia empresarial
            </p>
            <ol className="m-0 list-none space-y-2 px-2 pt-2 text-[10px] text-[var(--color-on-shell-muted)]">
              {['Operação', 'Medição', 'Faturamento', 'Financeiro', 'Fiscal', 'Contabilidade'].map(
                (label, index) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className="font-mono opacity-50">0{index + 1}</span>
                    {label}
                  </li>
                ),
              )}
            </ol>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-[var(--color-shell-border)] px-3 py-2 text-[10px] text-[var(--color-on-shell-muted)]">
        <Layers3 className="size-3" aria-hidden />
        CISNE · ERP operacional
      </div>
    </nav>
  );
}
