import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context/AuthProvider';
import { useAlertBadge } from '../alerts/hooks/useAlerts';
import { CommandPalette, useCommandPaletteShortcut } from '../operator/commands/CommandPalette';
import { isReleaseModuleEnabled } from '../release-scope/feature-flags';
import { ReleaseScopeGate } from '../release-scope/ReleaseScopeGate';
import { ShellBreadcrumbs } from './ShellBreadcrumbs';
import { ShellBrandMark } from './ShellBrandMark';
import { ShellErrorBoundary } from './ShellErrorBoundary';
import { ShellMobileDrawer } from './ShellMobileDrawer';
import { ShellNavList } from './ShellNavList';
import { ShellTopBar } from './ShellTopBar';
import { formatIdentityLabel } from './format-identity';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useRouteFocus } from './hooks/useRouteFocus';
import { useNavAccess } from './useNavAccess';
import './shell.css';
import './module-layout.css';

export function AppShellLayout() {
  const location = useLocation();
  const hideBreadcrumbs = location.pathname === '/app';
  const isDashboard = location.pathname === '/app';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 64rem)');
  const alertsEnabled = isReleaseModuleEnabled('alerts');
  const { activeCount, loading: alertsLoading } = useAlertBadge(alertsEnabled);
  const { identityId } = useAuth();

  /**
   * Command Center (Ctrl+K). Único dono do atalho — a barra de busca do topo
   * deixou de capturar Ctrl+K para não haver dois comportamentos no mesmo gesto.
   */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMounted, setPaletteMounted] = useState(false);
  useCommandPaletteShortcut(paletteOpen, (next) => {
    if (next) {
      setPaletteMounted(true);
    }
    setPaletteOpen(next);
  });

  useRouteFocus();

  function toggleMobileNav() {
    setMobileNavOpen((open) => !open);
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  const identityHint = formatIdentityLabel(identityId);

  return (
    <div className="cisne-app flex min-h-dvh bg-gray-50 font-sans text-gray-900 antialiased">
      <a
        className="shell__skip-link bg-brand-600 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        href="#main-content"
      >
        Ir para o conteúdo principal
      </a>

      <aside
        className="shell__sidebar fixed inset-y-0 z-30 hidden w-64 flex-col border-r border-white/5 bg-gray-950 lg:flex"
        aria-label="Barra lateral"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/5 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
            <ShellBrandMark className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-white">Cisne Rondônia</p>
            <p className="text-[11px] text-gray-500">Gestão operacional</p>
          </div>
        </div>

        <ShellNavList alertCount={activeCount} alertsLoading={alertsLoading} theme="dark" />

        <div className="border-t border-white/5 p-4">
          <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              CN
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-xs font-medium text-white">Conta ativa</p>
              <p className="truncate text-[11px] text-gray-500">{identityHint}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <ShellTopBar
          onMenuToggle={toggleMobileNav}
          menuExpanded={mobileNavOpen && !isDesktop}
          onOpenCommandPalette={() => {
            setPaletteMounted(true);
            setPaletteOpen(true);
          }}
        />
        <div className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <div
            className={
              isDashboard
                ? 'shell-page-frame dashboard-shell-frame mx-auto w-full min-w-0'
                : 'shell-page-frame mx-auto w-full max-w-6xl min-w-0'
            }
          >
            {!hideBreadcrumbs ? <ShellBreadcrumbs /> : null}
            <ReleaseScopeGate>
              <ShellErrorBoundary>
                <Outlet />
              </ShellErrorBoundary>
            </ReleaseScopeGate>
          </div>
        </div>
      </div>

      {!isDesktop ? (
        <div id="shell-mobile-drawer">
          <ShellMobileDrawer
            open={mobileNavOpen}
            onClose={closeMobileNav}
            alertCount={activeCount}
            alertsLoading={alertsLoading}
          />
        </div>
      ) : null}

      {/*
        A paleta só monta depois do primeiro Ctrl+K: assim os probes de acesso que
        ela usa para filtrar a navegação não custam nada a quem nunca a abre.
      */}
      {paletteMounted ? (
        <CommandPaletteHost open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      ) : null}
    </div>
  );
}

/**
 * Host da paleta: resolve o acesso real já apurado para a navegação e o repassa.
 * A paleta não decide acesso — ela respeita `isNavItemVisible`, a mesma regra do
 * menu lateral. Nenhum comando aqui amplia permissão.
 */
function CommandPaletteHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { access, loading } = useNavAccess();
  return <CommandPalette open={open} onClose={onClose} access={access} accessLoading={loading} />;
}
