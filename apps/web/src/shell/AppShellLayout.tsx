import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '../ui/utils/cn';
import { useAuth } from '../auth/context/AuthProvider';
import { useAlertBadge } from '../alerts/hooks/useAlerts';
import { CommandPalette, useCommandPaletteShortcut } from '../operator/commands/CommandPalette';
import { isReleaseModuleEnabled } from '../release-scope/feature-flags';
import { ReleaseScopeGate } from '../release-scope/ReleaseScopeGate';
import { PAGE_FRAME_CLASS, usePageLayoutMode } from './page-layout';
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
        SIDEBAR 216px — a largura da especificação do app shell. A largura é navegação; a área
        principal preserva a largura restante para listas e contexto empresarial.
      */}
      <aside
        className="shell__sidebar fixed inset-y-0 z-30 hidden w-[15.25rem] flex-col border-r border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] lg:flex"
        aria-label="Barra lateral"
      >
        {/*
          MARCA — 48px de altura, no degrau 44-52px do chrome.

          Eram 54px: a marca da navegacao ocupava a mesma altura da topbar e o topo da aplicacao
          virava duas faixas brancas/navy de peso igual. 48px mantem o logotipo, o nome e o
          subordinado "ERP corporativo" sem que a marca dispute com o conteudo.
        */}
        <div className="shell__brand flex h-[var(--shell-brand-height)] shrink-0 items-center gap-2.5 border-b border-[var(--color-shell-border)] px-3.5">
          {/*
            MARCA — o ponto de IDENTIDADE do chrome.

            A marca usa azul de interacao sobre navy; cyan/teal fica restrito aos detalhes de apoio
            dentro da area de trabalho.
          */}
          <div
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(140deg,#E8D3A0,#A9853F)] text-[13px] font-bold text-[var(--color-shell-surface)]"
            aria-hidden="true"
          >
            CR
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[14px] font-semibold tracking-tight text-[var(--color-on-shell)]">
              Cisne Rondônia
            </p>
            <p className="truncate font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--color-brand-400)]">
              ERP corporativo
            </p>
          </div>
        </div>

        <ShellNavList alertCount={activeCount} alertsLoading={alertsLoading} theme="dark" />

        <div className="border-t border-[var(--color-shell-border)] p-2.5">
          <div className="flex items-center gap-2.5 rounded-[4px] bg-[var(--color-shell-dock)] px-2.5 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[var(--color-blue-600)] text-[10px] font-bold text-white">
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

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[15.25rem]">
        <ShellTopBar
          onMenuToggle={toggleMobileNav}
          menuExpanded={mobileNavOpen && !isDesktop}
          onOpenCommandPalette={() => {
            setPaletteMounted(true);
            setPaletteOpen(true);
          }}
        />
        {/*
          AREA DE TRABALHO — O CANVAS COM MARGEM DE FERRAMENTA.

          O padding externo segue a especificacao do app shell: 20-24px horizontais e 16-20px
          verticais. Aqui: 22px horizontais, 16px no topo, 20px no rodape.

          Eram 18px/24px. O topo perde 2px de proposito — e o unico lado em que cada pixel gasto
          empurra a GRADE para fora da primeira dobra. O rodape mantem 20px porque e onde a ultima
          linha precisa respirar antes do fim da janela.

          A moldura NAO tem fundo proprio: o contraste do sistema vem do shell (sidebar navy +
          topbar branca) e do canvas cinza (`#F8FAFC`). Se a moldura pintasse tambem, voltariam as
          tres superficies empilhadas que produziam a leitura de "folha branca infinita".
        */}
        <div className="shell__content flex-1 px-[22px] pt-4 pb-5">
          <div
            className={cn(
              'shell-page-frame mx-auto w-full min-w-0',
              shellFillsViewport && 'shell-page-frame--fill',
              layoutMode === 'fullBleed' && 'shell-page-frame--bleed',
              PAGE_FRAME_CLASS[layoutMode],
              layoutMode === 'fullBleed' && 'px-0',
            )}
          >
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
