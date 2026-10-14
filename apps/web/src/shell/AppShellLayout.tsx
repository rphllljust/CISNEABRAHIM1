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
  /**
   * A PAGINA PREENCHE A VIEWPORT?
   *
   * `workspace` e `fullBleed` sao as superficies de BANCADA: nelas a grade e elastica e a altura e
   * a da tela. `focused`, `standard` e `wide` sao superficies de leitura/formulario, que crescem
   * com o proprio conteudo e rolam normalmente.
   */
  const shellFillsViewport = layoutMode === 'workspace' || layoutMode === 'fullBleed';
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
    <div className="cisne-app shell-enterprise flex min-h-dvh bg-[var(--color-canvas)] font-sans text-[var(--color-text-primary)] antialiased">
      <a
        className="shell__skip-link bg-brand-600 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        href="#main-content"
      >
        Ir para o conteúdo principal
      </a>

      {/*
        SIDEBAR 220px — a largura da especificacao do app shell.

        Eram 212px. A navegacao ganha 8px e o ITEM de menu passa a ter 36px de altura (era 30px):
        a faixa 34-40px e a densidade de sidebar do sistema, e 30px deixava o menu com aparencia de
        "lista de links" em vez de destinos de trabalho. A largura e NAVEGACAO, nao superficie de
        trabalho: ela nao cresce alem do que o rotulo mais longo precisa — quem opera a grade densa
        e a area de trabalho.
      */}
      <aside
        className="shell__sidebar fixed inset-y-0 z-30 hidden w-[13.75rem] flex-col border-r border-[var(--color-shell-chrome)] bg-[var(--color-shell-surface)] lg:flex"
        aria-label="Barra lateral"
      >
        {/*
          MARCA — 48px de altura, no degrau 44-52px do chrome.

          Eram 54px: a marca da navegacao ocupava a mesma altura da topbar e o topo da aplicacao
          virava duas faixas brancas/navy de peso igual. 48px mantem o logotipo, o nome e o
          subordinado "ERP corporativo" sem que a marca dispute com o conteudo.
        */}
        <div className="shell__brand flex h-12 shrink-0 items-center gap-2.5 border-b border-[var(--color-shell-chrome)] px-3.5">
          {/*
            MARCA EM TEAL — o unico lugar da sidebar onde o teal aparece em AREA. E o que da
            identidade ao chrome sem tingir a navegacao inteira de accent.
          */}
          <div className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[var(--color-brand-600)] shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset]">
            <ShellBrandMark className="h-3.5 w-3.5 text-[var(--color-on-shell)]" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-semibold tracking-tight text-[var(--color-on-shell)]">
              Cisne Rondônia
            </p>
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-on-shell-muted)]">
              ERP corporativo
            </p>
          </div>
        </div>

        <ShellNavList alertCount={activeCount} alertsLoading={alertsLoading} theme="dark" />

        <div className="border-t border-[var(--color-shell-chrome)] p-2.5">
          <div className="flex items-center gap-2.5 rounded-[4px] bg-[var(--color-shell-chrome)] px-2.5 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[var(--color-shell-dock-ink)] text-[10px] font-bold text-[var(--color-on-shell)]">
              CN
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-[11px] font-semibold text-[var(--color-on-shell)]">Conta ativa</p>
              {identityHint ? (
                <p className="truncate text-[10px] text-[var(--color-on-shell-muted)]">
                  {identityHint}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[13.75rem]">
        <ShellTopBar
          onMenuToggle={toggleMobileNav}
          menuExpanded={mobileNavOpen && !isDesktop}
          onOpenCommandPalette={() => {
            setPaletteMounted(true);
            setPaletteOpen(true);
          }}
        />
        {/*
          WORK AREA — CANVAS COM MARGEM DE FERRAMENTA.

          O padding externo e o da especificacao do app shell: 18px no topo, 22px nas laterais e
          24px no rodape. Antes ele era `px-3 py-2` (12/8px) — tao apertado que a superficie de
          trabalho encostava no chrome e a aplicacao lia como uma unica folha, sem o degrau visual
          entre "moldura do sistema" e "area onde o operador trabalha".

          A moldura continua SEM fundo proprio: o contraste do sistema vem do shell (sidebar navy
          + topbar branca) e do canvas (`--color-canvas`), que sao onde ele significa alguma coisa.
        */}
        <div className="shell__content flex-1 px-[22px] pt-[18px] pb-6">
          <div
            className={cn(
              'shell-page-frame mx-auto w-full min-w-0',
              shellFillsViewport && 'shell-page-frame--fill',
              layoutMode === 'fullBleed' && 'shell-page-frame--bleed',
              PAGE_FRAME_CLASS[layoutMode],
              layoutMode === 'fullBleed' && 'px-0',
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
        A AREA DE TRABALHO NAO TEM TETO DE ALTURA EM SUPERFICIE QUE PREENCHE.

        Quando a pagina e uma BANCADA (worklist, fila, central de controle), ela e uma grade de
        altura total: fila elastica + coluna de contexto. Para que `flex-1` e `height: 100%` de
        dentro dela resolvam contra a VIEWPORT — e nao contra a altura do proprio conteudo — o
        container do shell precisa ser um flex de altura minima zero.

        Isto era um seletor `:has(#main-content > .dashboard-cc)` cravado por ROTA: so o painel
        operacional preenchia a tela, e toda worklist abaixo dele media a altura do conteudo. O
        efeito medido em 1600x900 era 403px de canvas vazio em Clientes e 489px em Minhas pendencias.

        Agora a decisao e do MODO declarado pela pagina (`workspace` / `fullBleed`), que e onde ela
        pertence — a mesma declaracao que ja governa a largura.
      */}
      <style>{`.shell__content:has(> .shell-page-frame--fill){display:flex;min-height:0;flex:1 1 auto;flex-direction:column;}`}</style>

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
