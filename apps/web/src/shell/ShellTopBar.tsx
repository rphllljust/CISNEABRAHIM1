import { useId } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useAuth } from '../auth/context/AuthProvider';
import { AlertBadgeLink } from '../alerts/components/AlertBadgeLink';
import { isReleaseModuleEnabled } from '../release-scope/feature-flags';
import { GlobalSearchBar } from '../search/components/GlobalSearchBar';
import { formatUserMenuLabel } from './format-identity';
import { Dropdown } from '../ui/Dropdown';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';

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
      ALTURA 56px — a faixa 52-56px do sistema.

      Eram 64px (`h-[4rem]`): a topbar de um ERP desktop e CROME, nao conteudo, e cada 8px que ela
      retem sao 8px que a grade densa perde na primeira dobra. 56px ainda acomoda a busca principal,
      o sino e o menu de usuario com folga de ponteiro.
    */
    <header
      className="shell__topbar sticky top-0 z-20 flex h-[3.375rem] items-center gap-3 border-b border-[#D8E1EB] bg-white px-4 sm:px-5 lg:px-6"
      role="banner"
    >
      <button
        id={menuButtonId}
        type="button"
        className="inline-flex items-center gap-2 rounded-md border-0 bg-transparent p-2 font-inherit text-[#52647A] hover:bg-[#F2F5F9] lg:hidden"
        aria-expanded={menuExpanded}
        aria-controls="shell-mobile-drawer"
        onClick={onMenuToggle}
      >
        {menuExpanded ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        <span className="sr-only">{menuExpanded ? 'Fechar menu' : 'Abrir menu'}</span>
      </button>

      <div className="shell__search min-w-0 flex-1">
        <GlobalSearchBar compact />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {environmentLabel ? (
          <span
            className="hidden items-center rounded-md bg-[#FFF7E8] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#B45309] sm:inline-flex"
            aria-label={`Ambiente ${environmentLabel}`}
          >
            {environmentLabel}
          </span>
        ) : null}

        {isReleaseModuleEnabled('alerts') ? <AlertBadgeLink /> : null}

        {/*
          SELETOR DE IDIOMA — vive no topbar porque a preferência é do OPERADOR, não da
          tela: ela vale em qualquer rota e sobrevive à navegação. Fica antes do menu do
          usuário por ser uma preferência de menor frequência que o logout.
        */}
        <LanguageSwitcher className="hidden sm:flex" />

        {onOpenCommandPalette ? (
          <button
            type="button"
            className="hidden min-h-[var(--control-height)] items-center gap-2 rounded-md bg-[#1769E0] px-3 text-xs font-bold text-white transition-colors hover:bg-[#0D56C7] sm:inline-flex"
            onClick={onOpenCommandPalette}
            aria-label="Abrir central de comandos (Ctrl+K)"
          >
            <span>Comando</span>
            <kbd className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
              Ctrl K
            </kbd>
          </button>
        ) : null}

        <div className="hidden h-6 w-px bg-[#D8E1EB] sm:block" aria-hidden />

        <Dropdown
          label="Menu do usuário"
          trigger={
            <span className="flex cursor-pointer items-center gap-2.5 rounded-md p-1 pr-2 transition hover:bg-[#F2F5F9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
              {/*
                AVATAR EM TEAL — identidade CISNE no ponto de conta. O nome fica em peso 650 e o
                ambiente vira metadata: e a hierarquia de um application shell, nao de um formulario.
              */}
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0B8F88] text-[11px] font-bold text-white"
                aria-hidden="true"
              >
                CN
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-[12px] font-semibold text-[#071827]">{userLabel}</span>
                <span className="block text-[10px] text-[#52647A]">Cisne Rondônia</span>
              </span>
              <ChevronDown className="hidden size-4 text-[#7791AA] sm:block" aria-hidden />
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
