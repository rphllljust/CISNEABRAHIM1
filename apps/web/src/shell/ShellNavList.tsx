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
 * ITEM DE NAVEGACAO — 36px, a densidade da especificacao do app shell.
 *
 * Eram ~30px (`py-[0.3125rem]` sobre 13px). 36px devolve a faixa 34-38px que o sistema documenta
 * como densidade de navegacao e mantem a area de clique confortavel para ponteiro, sem que o menu
 * vire uma lista de botoes de toque.
 *
 * O ESTADO ATIVO E UM LAVADO AZUL DE 12%, COM BARRA DE 2px — NAO UM BLOCO PINTADO.
 *
 * O contrato do app shell e explicito:
 *
 *   active nav  background rgba(37,99,235,0.12)   +   indicator 2-3px   +   tinta de alto contraste
 *   hover       nav-hover
 *
 * Antes o ativo era `--color-shell-dock` — um azul de CHROME (o mesmo do dock de conta) com 3px de
 * accent. Dois defeitos: (a) o estado ativo reutilizava a cor de outra regiao, de modo que "voce esta
 * aqui" e "bloco de conta" liam igual; (b) era um retangulo de ponta a ponta, ou seja, o elemento
 * com MAIS area pintada do chrome inteiro numa tela onde o trabalho e o que importa.
 *
 * Agora o ativo usa o AZUL DE INTERACAO em 14% de opacidade, com barra de 2px e tinta BRANCA em peso
 * 600. O item continua inequivoco — barra + contraste + peso fazem isso — sem pintar area. E o azul e
 * a mesma familia da acao primaria do produto: o operador aprende uma cor para "isto esta ativo /
 * isto e o comando", na navegacao e na superficie.
 */
function buildNavLinkClass(isActive: boolean, theme: 'dark' | 'light') {
  if (theme === 'dark') {
    return cn(
      'group relative flex h-[var(--nav-row-height)] items-center gap-2 rounded-[4px] px-2.5 text-[13px] no-underline transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400',
      isActive
        ? 'bg-[var(--color-shell-active)] font-semibold text-[var(--color-shell-active-ink)] shadow-[inset_2px_0_0_0_var(--color-shell-active-indicator)]'
        : 'font-normal text-[var(--color-on-shell-nav)] hover:bg-[var(--color-shell-hover)] hover:text-[var(--color-on-shell)]',
    );
  }

  return cn(
    'group flex h-[var(--nav-row-height)] items-center gap-2 rounded-[4px] px-2.5 text-[13px] no-underline transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
    isActive
      ? 'bg-[var(--color-surface-selected)] font-semibold text-[var(--color-blue-800)] shadow-[inset_2px_0_0_0_var(--color-blue-600)]'
      : 'font-normal text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[color:var(--color-text-primary)]',
  );
}

function iconClass(isActive: boolean, theme: 'dark' | 'light') {
  if (theme === 'dark') {
    return cn(
      'h-4 w-4 shrink-0',
      isActive
        ? 'text-[var(--color-on-shell)]'
        : 'text-[var(--color-on-shell-muted)] group-hover:text-[var(--color-on-shell-nav)]',
    );
  }
  return cn(
    'h-4 w-4 shrink-0',
    isActive ? 'text-[var(--color-blue-700)]' : 'text-[color:var(--color-text-muted)]',
  );
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
        'sidebar-scroll flex-1 space-y-1 overflow-y-auto px-2.5 py-2',
        theme === 'dark' ? 'bg-[var(--color-shell-surface)]' : 'bg-white',
      )}
      aria-label="Navegação principal"
    >
      {loading ? (
        <p className="px-2 text-[13px] text-[var(--color-on-shell-muted)]" aria-live="polite">
          Carregando navegação…
        </p>
      ) : null}
      {SHELL_NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => isNavItemVisible(item.id, access, loading));
        if (visibleItems.length === 0) {
          return null;
        }

        return (
          <section key={group.id} aria-label={group.label} className="pt-2.5 first:pt-0">
            {/*
              SECTION LABEL — 10px, uppercase, tracking moderado, azul-acinzentado discreto.
              Ele separa GRUPOS por TOM, nao por caixa: a sidebar precisa de profundidade visual, e
              uma borda por grupo faria dela uma lista de retangulos.
            */}
            <p
              className={cn(
                'mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
                theme === 'dark'
                  ? 'text-[var(--color-on-shell-dim)]'
                  : 'text-[color:var(--color-text-muted)]',
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
