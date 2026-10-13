import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '../ui/utils/cn';
import { useAuth } from '../auth/context/AuthProvider';
import { useAlertBadge } from '../alerts/hooks/useAlerts';
import { CommandPalette, useCommandPaletteShortcut } from '../operator/commands/CommandPalette';
import { isReleaseModuleEnabled } from '../release-scope/feature-flags';
import { ReleaseScopeGate } from '../release-scope/ReleaseScopeGate';
import { PAGE_FRAME_CLASS, usePageLayoutMode } from './page-layout';
import { ShellBreadcrumbs } from './ShellBreadcrumbs';
import { ShellBrandMark } from './ShellBrandMark';
import { ShellErrorBoundary } from './ShellErrorBoundary';
import { ShellMobileDrawer } from './ShellMobileDrawer';
import { ShellNavList } from './ShellNavList';
import { ShellTopBar } from './ShellTopBar';
import { formatIdentityLabel, isTechnicalIdentity } from './format-identity';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useRouteFocus } from './hooks/useRouteFocus';
import { useNavAccess } from './useNavAccess';
import './shell.css';
import './module-layout.css';

export function AppShellLayout() {
  const location = useLocation();
  const hideBreadcrumbs = location.pathname === '/app';
  /**
   * LARGURA DA SUPERFICIE DE TRABALHO — page layout modes (Pagina 9 do relatorio).
   *
   * Antes, SO o painel (`/app`) escapava do `max-w-6xl`: toda outra rota — worklists densas de
   * ERP, relatorios, fiscal, contabil, fechamento — era espremida em 1152px mesmo em monitor de
   * 1440px+. O efeito era o operador ver poucas colunas, poucas linhas na primeira dobra e muito
   * vazio nas laterais: a leitura de "sistema antigo" que esta wave existe para eliminar.
   *
   * O teto agora NAO mora aqui nem em seletor `:has()` do CSS: a PAGINA declara o proprio modo
   * (`focused | standard | wide | workspace | fullBleed`) e o shell aplica. `workspace` e
   * `fullBleed` nao tem teto — e o modo das superficies que o relatorio nomeia (Finance, Fiscal,
   * Execution, Reconciliation, Journal), onde a grade densa E o produto.
   *
   * O valor e relido a cada render: o filho registra o modo ao renderizar, e o React renderiza o
   * filho antes de finalizar o commit deste frame, de modo que a largura ja sai correta no
   * primeiro paint — sem frame intermediario na largura da tela anterior.
   */
  const layoutMode = usePageLayoutMode();
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

  // Identidade tecnica (uuid) nao e identidade do operador: nesse caso a linha e OMITIDA
  // em vez de exibir um identificador truncado. `formatUserMenuLabel` ja segue a mesma regra
  // no menu do usuario; aqui o rotulo so aparece quando existe login humano de verdade.
  const identityHint = isTechnicalIdentity(identityId) ? null : formatIdentityLabel(identityId);

  return (
    <div className="cisne-app shell-enterprise flex min-h-dvh bg-[#e9eef3] font-sans text-gray-900 antialiased">
      <a
        className="shell__skip-link bg-brand-600 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        href="#main-content"
      >
        Ir para o conteúdo principal
      </a>

      {/*
        SIDEBAR 240px — a faixa 230-250px do sistema.

        Eram 288px (`w-[18rem]`). A sidebar e navegacao, nao superficie de trabalho: 48px devolvidos
        aqui sao 48px que a grade densa usa em TODAS as rotas — e numa worklist de sete colunas isso
        e a diferenca entre ver a coluna de acao e ter de rolar de lado. A densidade dos itens ja
        estava correta (34px); o que sobrava era largura vazia.
      */}
      <aside
        className="shell__sidebar fixed inset-y-0 z-30 hidden w-[15rem] flex-col border-r border-[#1f2d3a] bg-[#07111d] lg:flex"
        aria-label="Barra lateral"
      >
        <div className="shell__brand flex h-[4rem] shrink-0 items-center gap-3 border-b border-white/10 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-500 ring-1 ring-white/15">
            <ShellBrandMark className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight text-white">Cisne Rondônia</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              ERP corporativo
            </p>
          </div>
        </div>

        <ShellNavList alertCount={activeCount} alertsLoading={alertsLoading} theme="dark" />

        <div className="border-t border-white/10 p-4">
          <div className="shell__account-card flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.045] px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-xs font-semibold text-white">
              CN
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-xs font-semibold text-white">Conta ativa</p>
              {identityHint ? (
                <p className="truncate text-[11px] text-slate-500">{identityHint}</p>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[15rem]">
        <ShellTopBar
          onMenuToggle={toggleMobileNav}
          menuExpanded={mobileNavOpen && !isDesktop}
          onOpenCommandPalette={() => {
            setPaletteMounted(true);
            setPaletteOpen(true);
          }}
        />
        {/*
          WORK AREA — MARGEM MORTA ELIMINADA.

          Antes: `px-4 py-4 sm:px-6 lg:px-8` de canvas + `px-5 py-4 sm:px-6` de moldura — cerca de
          56px horizontais e 32px verticais consumidos antes do primeiro dado, em TODA página.
          Somado à moldura com borda e raio, o efeito perceptível era "uma folha branca dentro do
          ERP": documento, não ferramenta.

          Agora o padding externo é mínimo e a moldura não carrega respiro próprio — as regiões da
          página governam o seu. A área de trabalho encosta no shell e devolve largura útil.
        */}
        <div className="shell__content flex-1 px-3 py-2 sm:px-4">
          <div
            className={cn(
              'shell-page-frame mx-auto w-full min-w-0',
              layoutMode === 'fullBleed' && 'shell-page-frame--bleed',
              PAGE_FRAME_CLASS[layoutMode],
              layoutMode === 'fullBleed' ? 'px-0' : 'px-3 py-2',
            )}
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

      {/*
        O PAINEL OPERACIONAL NAO TEM TETO DE ALTURA.

        O shell e uma coluna de `min-h-dvh` com a area de trabalho em `flex-1`: sem esta declaracao, a
        pagina `/app` — que E uma grade de altura total (fila elastica + coluna de contexto) — mediria
        a altura do CONTEUDO, e o `height: 100%` de dentro do painel resolveria contra ela em vez de
        resolver contra a viewport. O efeito pratico seria a fila nunca "ocupar o resto da tela".

        Escopo por rota, no elemento raiz do shell: a sidebar (que ja e `fixed`) permanece de altura
        total, e as demais rotas continuam rolando normalmente.
      */}
      <style>{`:root:has(#main-content > .dashboard-cc) .shell__content{display:flex;min-height:0;flex:1 1 auto;}`}</style>

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
