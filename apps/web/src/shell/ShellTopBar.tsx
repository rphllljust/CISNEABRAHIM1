import { useId } from 'react';
import { ChevronDown, Menu, Search, X } from 'lucide-react';
import { useAuth } from '../auth/context/AuthProvider';
import { AlertBadgeLink } from '../alerts/components/AlertBadgeLink';
import { isReleaseModuleEnabled } from '../release-scope/feature-flags';
import { GlobalSearchBar } from '../search/components/GlobalSearchBar';
import { formatUserMenuLabel } from './format-identity';
import { Dropdown } from '../ui/Dropdown';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { ShellBreadcrumbs } from './ShellBreadcrumbs';

type ShellTopBarProps = {
  onMenuToggle: () => void;
  menuExpanded: boolean;
  /** Abre o Command Center. O atalho Ctrl+K é capturado pelo shell. */
  onOpenCommandPalette?: () => void;
};

function resolveEnvironmentLabel(): string | null {
  const mode = import.meta.env.MODE;
  if (!mode || mode === 'production') {
    return null;
  }
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function ShellTopBar({
  onMenuToggle,
  menuExpanded,
  onOpenCommandPalette,
}: ShellTopBarProps) {
  const menuButtonId = useId();
  const { identityId, logout } = useAuth();
  const environmentLabel = resolveEnvironmentLabel();
  const userLabel = formatUserMenuLabel(identityId);

  return (
    /*
      TOPBAR — BRANCA, 52px, COM REGUA DE 1px.

      A topbar de um ERP desktop e CROME, nao conteudo: cada 8px que ela retem sao 8px que a grade
      densa perde na primeira dobra. 52px (`--shell-chrome-height`) fecha a faixa prevista para o
      app shell corporativo e acomoda busca, sino, idioma, comando e menu de conta com folga de
      ponteiro.

      Eram 54px — dois pixels acima do topo da faixa, sem ganho funcional nenhum.

      BRANCA, e nao navy: o chrome escuro do CISNE e a NAVEGACAO (a sidebar). Se a topbar tambem
      fosse escura, o topo da aplicacao viraria um bloco unico e o conteudo perderia o segundo ponto
      de ancoragem. Branca sobre o canvas `#F8FAFC`, ela delimita a area de trabalho por cima; a
      sidebar navy delimita por baixo. A moldura fecha.
    */
    <header
      className="shell__topbar sticky top-0 z-20 flex h-[var(--shell-chrome-height)] shrink-0 items-center gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-surface-header)] px-4 sm:px-5 lg:px-8"
      role="banner"
    >
      <button
        id={menuButtonId}
        type="button"
        className="inline-flex items-center gap-2 rounded-[4px] border-0 bg-transparent p-2 font-inherit text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] lg:hidden"
        aria-expanded={menuExpanded}
        aria-controls="shell-mobile-drawer"
        onClick={onMenuToggle}
      >
        {menuExpanded ? (
          <X className="size-5" aria-hidden />
        ) : (
          <Menu className="size-5" aria-hidden />
        )}
        <span className="sr-only">{menuExpanded ? 'Fechar menu' : 'Abrir menu'}</span>
      </button>

      {/*
        BUSCA GLOBAL CONTIDA — 420-600px, alinhada ao inicio do conteudo.

        Antes ela era `flex-1` e esticava por toda a largura livre entre a sidebar e o cluster de
        utilitarios: o campo de busca virava a maior superficie da topbar e a aplicacao abria com
        cara de "formulario horizontal". Um teto em 600px mantem o campo com o tamanho de um CAMPO
        — busca de ERP nao e hero — e devolve o meio da barra para o que e chrome de verdade.
      */}
      <div className="hidden min-w-0 flex-1 lg:block">
        <ShellBreadcrumbs />
      </div>
      <div className="shell__search w-full min-w-0 max-w-[26rem]">
        <GlobalSearchBar compact />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {environmentLabel ? (
          <span
            className="hidden items-center rounded-[4px] bg-[var(--color-warning-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-warning-fg)] sm:inline-flex"
            aria-label={`Ambiente ${environmentLabel}`}
          >
            {environmentLabel}
          </span>
        ) : null}

        {isReleaseModuleEnabled('alerts') ? <AlertBadgeLink /> : null}

        {/*
          COMANDO — UTILITY CONTROL DISCRETO, NAO BOTAO PRIMARIO.

          Antes: `bg-[var(--color-cisne-action)]` — um bloco teal cheio no canto da topbar, o
          elemento mais saturado do chrome inteiro, para um atalho de teclado. Agora ele e um
          CONTROLE DE UTILIDADE: mesma altura dos vizinhos, fundo neutro, atalho dito em `<kbd>`.
          O comando nao precisa gritar — ele precisa estar alcancavel.
        */}
        {onOpenCommandPalette ? (
          <button
            type="button"
            className="hidden h-[30px] items-center gap-2 rounded-[4px] border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] px-2 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] sm:inline-flex"
            onClick={onOpenCommandPalette}
            aria-label="Abrir central de comandos (Ctrl+K)"
          >
            <Search className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">Comando</span>
            <kbd className="rounded-[3px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-context)] px-1 font-mono text-[10px] font-semibold text-[var(--color-text-muted)]">
              Ctrl K
            </kbd>
          </button>
        ) : null}

        {/*
          SELETOR DE IDIOMA — vive no topbar porque a preferência é do OPERADOR, não da
          tela: ela vale em qualquer rota e sobrevive à navegação. Fica antes do menu do
          usuário por ser uma preferência de menor frequência que o logout.
        */}
        <LanguageSwitcher className="hidden sm:flex" />

        <div className="mx-1 hidden h-5 w-px bg-[var(--color-divider)] sm:block" aria-hidden />

        <Dropdown
          label="Menu do usuário"
          trigger={
            <span className="flex cursor-pointer items-center gap-2 rounded-[4px] p-1 pr-2 transition hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
              {/*
                AVATAR EM TEAL — identidade CISNE no ponto de conta. O nome fica em peso 600 e o
                ambiente vira metadata: e a hierarquia de um application shell, nao de um formulario.
              */}
              <span
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--color-shell-surface)] text-[12px] font-semibold text-[#E8D3A0] shadow-[0_0_0_2px_var(--color-surface-header),0_0_0_3px_var(--color-brand-400)]"
                aria-hidden="true"
              >
                CN
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-[12px] font-semibold text-[var(--color-text-primary)]">
                  {userLabel}
                </span>
                <span className="block text-[10px] text-[var(--color-text-muted)]">
                  Cisne Rondônia
                </span>
              </span>
              <ChevronDown
                className="hidden size-3.5 text-[var(--color-text-muted)] sm:block"
                aria-hidden
              />
            </span>
          }
          items={[
            {
              id: 'logout',
              label: 'Sair',
              onSelect: () => {
                void logout();
              },
            },
          ]}
        />
      </div>
    </header>
  );
}
