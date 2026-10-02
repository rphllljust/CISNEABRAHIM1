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
    <header
      className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-gray-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8"
      role="banner"
    >
      <button
        id={menuButtonId}
        type="button"
        className="inline-flex items-center gap-2 rounded-md border-0 bg-transparent p-2 font-inherit text-gray-600 hover:bg-gray-100 lg:hidden"
        aria-expanded={menuExpanded}
        aria-controls="shell-mobile-drawer"
        onClick={onMenuToggle}
      >
        {menuExpanded ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        <span className="sr-only">{menuExpanded ? 'Fechar menu' : 'Abrir menu'}</span>
      </button>

      <div className="max-w-md min-w-0 flex-1">
        <GlobalSearchBar compact />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {environmentLabel ? (
          <span
            className="hidden items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 sm:inline-flex"
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
            className="hidden items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 sm:inline-flex"
            onClick={onOpenCommandPalette}
            aria-label="Abrir central de comandos (Ctrl+K)"
          >
            <span>Navegar, ver, criar…</span>
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
              Ctrl K
            </kbd>
          </button>
        ) : null}

        <div className="hidden h-6 w-px bg-gray-200 sm:block" aria-hidden />

        <Dropdown
          label="Menu do usuário"
          trigger={
            <span className="flex cursor-pointer items-center gap-2.5 rounded-full p-1 pr-2 transition hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white"
                aria-hidden="true"
              >
                CN
              </span>
              <span className="hidden text-sm font-medium text-gray-700 sm:block">{userLabel}</span>
              <ChevronDown className="hidden size-4 text-gray-400 sm:block" aria-hidden />
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
