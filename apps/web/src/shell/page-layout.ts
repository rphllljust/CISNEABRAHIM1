/**
 * PAGE LAYOUT MODES — a largura da superficie de trabalho e uma DECISAO DA PAGINA.
 *
 * Conforme a Pagina 9 do relatorio ("1. Shell e navegacao"), o shell opera hoje como
 * "container de paginas", enquanto os ERPs de referencia tratam shell e workspace como
 * sistema de trabalho. O relatorio pede explicitamente:
 *
 *   "Criar page layout modes: focused, standard, wide, workspace e fullBleed.
 *    Reconciliation, Diario/Journal, Fiscal e Execution nao devem obedecer ao
 *    mesmo max-width de um cadastro simples."
 *
 * ANTES: a largura era decidida no CSS por seletor `:has(> .alguma-classe)`
 * (`module-layout.css`). A pagina nao declarava nada, e o teto real virava um efeito
 * colateral de qual classe raiz a tela por acaso usava — 60rem para quem caia no ramo
 * generico, mesmo sendo mesa de trabalho densa de tesouraria.
 *
 * AGORA: a pagina declara o proprio modo, o shell aplica o teto, e a regra fica em UM lugar.
 * A pagina REGISTRA a declaracao para o frame do shell (que precisa da largura antes de
 * renderizar o filho) e as classes `frameClass` espelham o mesmo teto para quem renderiza
 * fora do shell.
 *
 * O teto NAO e decoracao: `workspace` existe para as telas que o relatorio nomeia — Finance,
 * Fiscal, Execution, Reconciliation, Journal — e que perdiam colunas e linhas na primeira
 * dobra por obedecerem ao mesmo limite de um formulario de cadastro.
 */

import { useLayoutEffect, useSyncExternalStore } from 'react';

export type PageLayoutMode = 'focused' | 'standard' | 'wide' | 'workspace' | 'fullBleed';

export const DEFAULT_PAGE_LAYOUT_MODE: PageLayoutMode = 'standard';

/**
 * Teto de cada modo, em rem. `null` = sem teto (a superficie ocupa toda a largura util).
 *
 * - focused   56rem — um fluxo, uma decisao (login, confirmacao, cadastro curto);
 * - standard  72rem — leitura de objeto e formulario comum;
 * - wide      90rem — worklist densa, relatorio, mesa de trabalho;
 * - workspace  none — workspace operacional: sem teto, porque a grade densa E o produto;
 * - fullBleed  none — superficie que desenha a propria moldura (reconciliation, canvas).
 */
export const PAGE_LAYOUT_MAX_REM: Record<PageLayoutMode, number | null> = {
  focused: 56,
  standard: 72,
  wide: 90,
  workspace: null,
  fullBleed: null,
};

/** Larguras efetivas aplicadas por `AppShellLayout`. */
export const PAGE_FRAME_CLASS: Record<PageLayoutMode, string> = {
  focused: 'max-w-[56rem]',
  standard: 'max-w-[72rem]',
  wide: 'max-w-[90rem]',
  workspace: 'max-w-none',
  fullBleed: 'max-w-none px-0',
};

export function isPageLayoutMode(value: unknown): value is PageLayoutMode {
  return (
    value === 'focused' ||
    value === 'standard' ||
    value === 'wide' ||
    value === 'workspace' ||
    value === 'fullBleed'
  );
}

/**
 * REGISTRO DO MODO — a pagina declara, o shell le.
 *
 * `AppShellLayout` precisa da largura para enquadrar `<Outlet />`, e o modo so existe DEPOIS
 * que a pagina filha renderiza. Ler o registro durante o render do shell devolve o modo da tela
 * ANTERIOR (medido: `/app/finance` saia em 72rem com a pagina declarando `workspace`).
 *
 * A declaracao e publicada em `useLayoutEffect`, NUNCA durante o render: notificar o shell no
 * meio da renderizacao do filho produz `Cannot update a component while rendering a different
 * component` — o React pinta a arvore em estado inconsistente. O layout effect roda depois que
 * a arvore foi montada e ANTES do navegador pintar, entao o shell re-renderiza uma unica vez, o
 * frame sai na largura correta e nenhum frame intermediario chega a tela.
 */
let declaredMode: PageLayoutMode = DEFAULT_PAGE_LAYOUT_MODE;
const listeners = new Set<() => void>();

/**
 * Declara o modo da superficie. Uso interno de `ModulePage` — o par declare/observer mora aqui
 * para que a regra de largura fique em UM lugar.
 */
export function useDeclarePageLayoutMode(mode: PageLayoutMode): void {
  useLayoutEffect(() => {
    if (declaredMode === mode) {
      return;
    }
    declaredMode = mode;
    for (const listener of listeners) {
      listener();
    }
  }, [mode]);
}

export function readPageLayoutMode(): PageLayoutMode {
  return declaredMode;
}

export function subscribePageLayoutMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Leitura reativa do modo declarado — usada pelo frame do shell. */
export function usePageLayoutMode(): PageLayoutMode {
  return useSyncExternalStore(subscribePageLayoutMode, readPageLayoutMode);
}

/** Reset entre navegacoes para que uma tela nunca herde o teto da anterior. */
export function resetPageLayoutMode(): void {
  declaredMode = DEFAULT_PAGE_LAYOUT_MODE;
  for (const listener of listeners) {
    listener();
  }
}
