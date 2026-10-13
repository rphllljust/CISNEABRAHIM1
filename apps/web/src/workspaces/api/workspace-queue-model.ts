import {
  WORK_KIND_LABELS,
  type WorkDomain,
  type WorkInboxPage,
  type WorkItem,
  type WorkKind,
} from '../../work-inbox/api/work-inbox-api';

/**
 * O RECORTE DA FILA DE UM WORKSPACE — modelo unico, compartilhado.
 *
 * O My Inbox (`/app/work-inbox`), o workspace financeiro (`/app/finance`), os workspaces de dominio
 * (`/app/workspaces/<dominio>`) e a fila do painel operacional desenham a MESMA fila sobre o MESMO
 * read model (`GET /work-inbox`). O que muda entre eles e o ESCOPO e o CABECALHO — nunca a semantica
 * do recorte.
 *
 * Este arquivo existe para que essa semantica seja escrita UMA vez:
 *
 *   - quais dimensoes o contrato do read model executa (`domain`, `kind`, `status`, `unitId`,
 *     `overdue`), porque uma visao salva que o servidor nao executa volta como lista inteira e o
 *     operador acha que recortou;
 *   - como o escopo ativo viaja na URL e volta dela, para que recarregar/voltar/compartilhar
 *     preservem a fila;
 *   - como um escopo vira rotulo humano e como vira `href` para a fila COMPLETA com o MESMO
 *     recorte (o caminho pelo qual o operador sai da amostra para o conjunto).
 *
 * Nada aqui le, conta ou deriva dado de negocio: e vocabulario de recorte. Contagem continua sendo
 * `total` publicado pelo servidor.
 */

import { WORK_DOMAIN_LABELS } from '../../work-inbox/api/work-inbox-api';

/**
 * Naturezas oferecidas como recorte rapido.
 *
 * Sao exatamente as que o contrato aceita em `kind`. `CONTINUITY` fica fora de proposito: nao ha
 * recorte rapido permanente para "continuidade" — ela continua alcancavel pela natureza no filtro
 * avancado, sem virar botao que o operador nao usa.
 */
export const WORKSPACE_QUEUE_KINDS: ReadonlyArray<{ kind: WorkKind; label: string }> = [
  { kind: 'BLOCKER', label: 'Bloqueios' },
  { kind: 'OVERDUE', label: 'Vencidos' },
  { kind: 'APPROVAL', label: 'Aguardando aprovação' },
  { kind: 'EXCEPTION', label: 'Exceções' },
];

/**
 * RECORTE ATIVO da fila.
 *
 * As dimensoes sao as do contrato do read model e nada alem: `domain`, `kind`, `status`, `unitId`,
 * `overdue`. `scope` nao tem campo derivado, contador nem copia de dado de negocio — o recorte e
 * uma CONSULTA, e quem a executa e o servidor.
 */
export type WorkspaceQueueScope = {
  domain: WorkDomain | null;
  kind: WorkKind | null;
  overdue: boolean;
  unitId: string | null;
};

export const ALL_WORKSPACE_QUEUE_SCOPE: WorkspaceQueueScope = {
  domain: null,
  kind: null,
  overdue: false,
  unitId: null,
};

/** Naturezas validas para recorte — o mesmo vocabulario do read model. */
function findKind(value: string | null): WorkKind | null {
  return WORKSPACE_QUEUE_KINDS.find((candidate) => candidate.kind === value)?.kind ?? null;
}

function findDomain(value: string | null): WorkDomain | null {
  if (!value) {
    return null;
  }
  return (Object.keys(WORK_DOMAIN_LABELS) as WorkDomain[]).find((domain) => domain === value) ?? null;
}

/**
 * O escopo veio da URL?
 *
 * A URL e a fonte do recorte quando a tela E a propria fila (My Inbox): voltar, recarregar e
 * compartilhar levam ao mesmo conjunto. Quando ela nao traz recorte, `null` significa "nenhum
 * recorte declarado" — que e diferente de "recorte vazio", e o chamador decide o padrao.
 */
export function scopeFromSearchParams(params: URLSearchParams): WorkspaceQueueScope | null {
  const scope: WorkspaceQueueScope = {
    domain: findDomain(params.get('domain')),
    kind: findKind(params.get('kind')),
    overdue: params.get('overdue') === 'true',
    unitId: params.get('unitId'),
  };
  if (isAllScope(scope)) {
    return null;
  }
  return scope;
}

/** O recorte como parametros de URL — a forma que o operador pode copiar e compartilhar. */
export function scopeToSearchParams(scope: WorkspaceQueueScope): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.domain) {
    params.set('domain', scope.domain);
  }
  if (scope.kind) {
    params.set('kind', scope.kind);
  }
  if (scope.overdue) {
    params.set('overdue', 'true');
  }
  if (scope.unitId) {
    params.set('unitId', scope.unitId);
  }
  return params;
}

/**
 * O MESMO recorte gravado numa visao salva.
 *
 * Só entram dimensoes que o servidor executa. Guardar dado de negocio dentro de uma visao seria
 * manter uma copia de dado autoritativo no navegador.
 */
export function scopeToSavedFilters(scope: WorkspaceQueueScope): Record<string, string> {
  const filters: Record<string, string> = {};
  if (scope.domain) {
    filters['domain'] = scope.domain;
  }
  if (scope.kind) {
    filters['kind'] = scope.kind;
  }
  if (scope.overdue) {
    filters['overdue'] = 'true';
  }
  if (scope.unitId) {
    filters['unitId'] = scope.unitId;
  }
  return filters;
}

/** Uma visao salva volta a ser escopo executavel; qualquer coisa fora do contrato e descartada. */
export function scopeFromSavedFilters(filters: Record<string, string>): WorkspaceQueueScope {
  return {
    domain: findDomain(filters['domain'] ?? null),
    kind: findKind(filters['kind'] ?? null),
    overdue: filters['overdue'] === 'true',
    unitId: filters['unitId'] ?? null,
  };
}

export function isAllScope(scope: WorkspaceQueueScope): boolean {
  return scope.domain === null && scope.kind === null && !scope.overdue && scope.unitId === null;
}

export function scopeEquals(a: WorkspaceQueueScope, b: WorkspaceQueueScope): boolean {
  return (
    a.domain === b.domain && a.kind === b.kind && a.overdue === b.overdue && a.unitId === b.unitId
  );
}

/** "Todo o trabalho" / "Bloqueios" / "Vencidos" — em linguagem humana, nunca em codigo interno. */
export function scopeLabel(scope: WorkspaceQueueScope): string {
  if (scope.kind === null) {
    return scope.overdue ? 'Vencidos no prazo' : 'Todo o trabalho';
  }
  return WORKSPACE_QUEUE_KINDS.find((candidate) => candidate.kind === scope.kind)?.label ?? 'Recorte';
}

/**
 * A FILA COMPLETA com o MESMO recorte.
 *
 * Este e o unico caminho honesto da amostra para o conjunto: o operador sai de "ate N itens" para a
 * lista paginada levando exatamente o recorte que estava vendo — sem perder o filtro e sem ter de
 * remonta-lo a mao na outra tela.
 */
export function workInboxHref(scope: WorkspaceQueueScope): string {
  const query = scopeToSearchParams(scope).toString();
  return query ? `/app/work-inbox?${query}` : '/app/work-inbox';
}

/**
 * Pedido de leitura da fila para o cliente — SEMPRE recortado no servidor.
 *
 * `limit`/`offset` sao do chamador porque cada superficie mostra um tamanho de amostra diferente; o
 * que este modelo garante e que TODAS as dimensoes do escopo viajam para o servidor e que o
 * navegador nao filtra depois.
 */
export function workspaceQueueQuery(
  scope: WorkspaceQueueScope,
  options: { limit: number; offset?: number },
): {
  domain?: WorkDomain;
  kind?: WorkKind;
  overdue?: boolean;
  unitId?: string;
  limit: number;
  offset: number;
} {
  return {
    ...(scope.domain ? { domain: scope.domain } : {}),
    ...(scope.kind ? { kind: scope.kind } : {}),
    ...(scope.overdue ? { overdue: true } : {}),
    ...(scope.unitId ? { unitId: scope.unitId } : {}),
    limit: options.limit,
    offset: options.offset ?? 0,
  };
}

/**
 * Quanto do conjunto a amostra esta mostrando.
 *
 * A frase NUNCA e reduzida a "N itens no recorte": mesmo quando a amostra cobre o conjunto inteiro,
 * o operador precisa ler a RELACAO entre o que esta na tela e o que o servidor contou. "1 item no
 * recorte" some com essa relacao e deixa a pagina passando por conjunto — que e exatamente o defeito
 * que o `total` do read model existe para impedir. Quando a amostra cobre tudo, diz "1 de 1"; quando
 * cobre parte, diz "Exibindo 6 de 41".
 */
export function coverageLabel(page: WorkInboxPage, shown: number): string {
  const total = page.total;
  if (total <= 0) {
    return 'Nenhum item no recorte';
  }
  const noun = total === 1 ? 'item' : 'itens';
  if (shown >= total) {
    return `${total} de ${total} ${noun} no recorte`;
  }
  return `Exibindo ${shown} de ${total} ${noun}`;
}

/** Natureza em linguagem humana — para quando a linha precisa dizer O QUE ela e. */
export function kindLabel(kind: WorkKind): string {
  return WORK_KIND_LABELS[kind];
}

/**
 * O QUE A FILA NAO CONSEGUIU LER.
 *
 * Uma zona de dominio que aparece vazia porque UMA leitura falhou e uma mentira visual: o operador
 * conclui "nao ha trabalho" quando o fato e "nao consegui ler". Esta frase e a unica traducao
 * permitida de uma leitura parcial — e ela nunca diz "0".
 */
export function unavailableWorkNotice(domains: readonly string[]): string | null {
  if (domains.length === 0) {
    return null;
  }
  const names = domains
    .map((domain) => (WORK_DOMAIN_LABELS as Record<string, string>)[domain] ?? domain)
    .join(', ');
  return `Fila incompleta: ${names} não respondeu nesta leitura. O restante do recorte está completo — o que falta é desconhecido, não é zero.`;
}

/** Itens do recorte carregado, com o item selecionado resolvido para o objeto atual do servidor. */
export function resolveSelectedItem(
  items: readonly WorkItem[],
  selectedId: string | null,
): WorkItem | null {
  if (!selectedId) {
    return null;
  }
  return items.find((item) => item.id === selectedId) ?? null;
}

