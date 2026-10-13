import { NavLink } from 'react-router-dom';
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

/**
 * ITEM DE NAVEGACAO — densidade de ERP, nao de landing page.
 *
 * `py-2.5` produzia ~44px por item, o mesmo alvo de um botao de toque em aplicativo movel. O CISNE
 * e uma aplicacao desktop primariamente: com ~40 itens no menu, o operador perdia linhas na primeira
 * dobra e rolava para trocar de modulo. `py-1.5` entrega ~34px — dentro da faixa que o proprio
 * sistema documenta como densidade de sidebar (`34-40px`) em `theme.css` — mantendo area de clique
 * confortavel para ponteiro.
 *
 * O ESTADO ATIVO NAO MUDOU DE GRAMATICA: fundo ligeiramente elevado + accent na lateral + texto
 * claro (dark) / fundo neutro + texto forte (light). O que saiu foi apenas a sobra: a sombra de 18px
 * do item ativo, que fazia o item "flutuar" dentro da propria sidebar — o accent de 3px a esquerda
 * ja e inequivoco e nao custa contraste de texto.
 */
function buildNavLinkClass(isActive: boolean, theme: 'dark' | 'light') {
  if (theme === 'dark') {
    return cn(
      'group relative flex items-center gap-2 rounded-md px-2 py-[0.3125rem] text-[13px] font-medium no-underline transition',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
      isActive
        ? 'bg-white/[0.105] text-white shadow-[inset_3px_0_0_#72bcb4]'
        : 'text-slate-400 hover:bg-white/[0.065] hover:text-white',
    );
  }

  return cn(
    'group flex items-center gap-2 rounded-md px-2 py-[0.3125rem] text-[13px] font-medium no-underline transition',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
    isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
  );
}

function iconClass(isActive: boolean, theme: 'dark' | 'light') {
  if (theme === 'dark') {
    return cn(
      'h-4 w-4 shrink-0',
      isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300',
    );
  }
  return cn('h-4 w-4 shrink-0', isActive ? 'text-brand-600' : 'text-gray-400');
}

export function ShellNavList({
  onNavigate,
  alertCount = 0,
  alertsLoading = false,
  theme = 'dark',
}: ShellNavListProps) {
  const { loading, access } = useNavAccess();

  return (
    <nav
      className={cn(
        'sidebar-scroll flex-1 space-y-3 overflow-y-auto px-2.5 py-2.5',
        theme === 'dark' ? 'bg-[#07111d]' : 'bg-white',
      )}
      aria-label="Navegação principal"
    >
      {loading ? (
        <p className="px-2 text-[13px] text-gray-500" aria-live="polite">
          Carregando navegação…
        </p>
      ) : null}
      {SHELL_NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => isNavItemVisible(item.id, access, loading));
        if (visibleItems.length === 0) {
          return null;
        }

        return (
          <section key={group.id} aria-label={group.label}>
            <p
              className={cn(
                'mb-1.5 px-2 text-[9px] font-semibold uppercase tracking-[0.18em]',
                theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
              )}
            >
              {group.label}
            </p>
            <ul className="m-0 flex list-none flex-col gap-px p-0">
              {visibleItems.map((item) => {
                const Icon = resolveNavIcon(item.id);
                return (
                  <li key={item.id}>
                    <NavLink
                      to={item.path}
                      className={({ isActive }) => buildNavLinkClass(isActive, theme)}
                      end={item.path === '/app'}
                      onClick={onNavigate}
                    >
                      {({ isActive }) => (
                        <>
                          {/*
                            `aria-hidden` no lucide NAO basta: quando o rotulo acessivel do
                            `<svg>` tambem e renderizado, o leitor de tela le
                            "Users Clientes" — nome do modulo prefixado pelo nome do icone.
                            `focusable={false}` tambem tira o icone da ordem de tabulacao no
                            Edge/IE legado.
                          */}
                          <Icon
                            className={iconClass(isActive, theme)}
                            strokeWidth={2}
                            aria-hidden="true"
                            aria-label={undefined}
                            focusable={false}
                          />
                          <span className="min-w-0 flex-1">{item.label}</span>
                          {item.id === 'alerts' && !alertsLoading && alertCount > 0 ? (
                            <span
                              className="inline-flex min-w-5 justify-center rounded-full bg-red-500/15 px-1.5 text-xs font-medium text-red-400"
                              aria-hidden="true"
                            >
                              {alertCount > 99 ? '99+' : alertCount}
                            </span>
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
