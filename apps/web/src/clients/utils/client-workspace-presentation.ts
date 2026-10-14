import { useMemo } from 'react';
import type {
  ClientDataQuality,
  ClientFinancialContext,
  ClientHierarchy,
  ClientStatus,
  ClientSummary,
} from '../types/client.types';

/**
 * DERIVAÇÕES DO CUSTOMER WORKSPACE.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * REGRA ÚNICA: NADA AQUI AFIRMA DADO QUE O BACKEND NÃO PUBLICOU.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Tudo neste arquivo é CLASSIFICAÇÃO e LEITURA do que já veio na resposta. Nenhuma contagem é
 * estimada, nenhum indicador é inventado, e ausência nunca vira zero:
 *
 *   sem contagem publicada  ≠ 0
 *   sem recebível publicado ≠ R$ 0,00
 *   sem próxima ação        ≠ "em dia"
 *
 * Uma amostra (a página) é sempre rotulada como página. Só o que o servidor afirma como TOTAL é
 * exibido sem qualificação.
 */

/** Rótulo humano da situação — o mesmo vocabulário do badge, sem o pill. */
export function clientStatusLabel(status: ClientStatus): string {
  return status === 'ACTIVE' ? 'Ativo' : 'Inativo';
}

export type AttentionLevel = 'blocking' | 'attention' | 'ok' | 'unknown';

export type ClientAttention = {
  level: AttentionLevel;
  /** Texto curto do que exige o operador. `null` quando não há sinal publicado. */
  reason: string | null;
};

/**
 * ATENÇÃO DO REGISTRO — EXCEPTION-FIRST, E HONESTA SOBRE O DESCONHECIDO.
 *
 * A worklist precisa responder "em qual Cliente eu mexo agora?". A resposta usa SOMENTE sinais
 * publicados:
 *
 *  1. cadastro INATIVO — fato persistido: o Cliente não entra em novos documentos.
 *  2. qualidade com apontamento `blocking` — o servidor avaliou e algo impede operar.
 *  3. qualidade com `attention` — o servidor avaliou e algo produz erro a jusante.
 *
 * SEM QUALIDADE CARREGADA O NÍVEL É `unknown`, e NÃO `ok`. Listar 20 Clientes e buscar a qualidade
 * de cada um seria N+1 no caminho de leitura da lista; afirmar "em dia" sem ter avaliado seria
 * inventar. `unknown` é um estado de primeira classe e a UI o exibe como tal.
 */
export function deriveClientAttention(
  client: ClientSummary,
  quality: ClientDataQuality | undefined,
): ClientAttention {
  if (client.status === 'INACTIVE') {
    return { level: 'blocking', reason: 'Fora de operação' };
  }
  if (!quality) {
    return { level: 'unknown', reason: null };
  }
  if (!quality.evaluated) {
    return { level: 'unknown', reason: null };
  }
  const blocking = quality.findings.find((finding) => finding.severity === 'blocking');
  if (blocking) {
    return { level: 'blocking', reason: blocking.summary };
  }
  const attention = quality.findings.find((finding) => finding.severity === 'attention');
  if (attention) {
    return { level: 'attention', reason: attention.summary };
  }
  return { level: 'ok', reason: null };
}

/**
 * PRÓXIMA AÇÃO DO REGISTRO NA FILA.
 *
 * Derivada de ESTADO + CAPABILITY, exatamente como na object page — e nunca de dado inventado.
 * O destino é a object page, e não uma transição disparada da linha: a projeção de listagem
 * publica `version`, mas executar daqui exigiria confirmar motivo em um caso (desativar) e
 * capturar contexto no outro. A linha faz DRILLBACK para onde o comando real roda com o contrato
 * de escrita intacto.
 */
export function deriveClientNextAction(
  client: ClientSummary,
  capabilities: { canActivate: boolean; canDeactivate: boolean; canRead: boolean },
): { label: string; pending: boolean } {
  if (client.status === 'INACTIVE') {
    return capabilities.canActivate
      ? { label: 'Reativar cadastro', pending: true }
      : { label: 'Cadastro inativo', pending: false };
  }
  if (capabilities.canDeactivate) {
    return { label: 'Abrir cadastro', pending: false };
  }
  return { label: capabilities.canRead ? 'Abrir cadastro' : 'Sem ação disponível', pending: false };
}

/**
 * CONTAGEM DO RECORTE — SEMPRE ROTULADA PELA SUA ORIGEM.
 *
 * `total` é o total AUTORIZADO que o servidor informa sob os filtros atuais. As demais contagens
 * são calculadas sobre as LINHAS QUE VOLTARAM, e por isso carregam `scope: 'page'` — a UI é
 * obrigada a dizer "nesta página". Apresentar a contagem da página como se fosse da carteira é o
 * defeito que esta estrutura existe para impedir.
 */
export type ClientQueueMetric = {
  id: string;
  label: string;
  value: number;
  /** `total` = afirmado pelo servidor; `page` = contado sobre a página carregada. */
  scope: 'total' | 'page';
  hint: string;
  tone: 'neutral' | 'attention' | 'critical' | 'settled';
};

export function buildQueueMetrics(
  items: ClientSummary[],
  total: number,
  hasFilters: boolean,
  inactiveCount: number,
): ClientQueueMetric[] {
  const activeOnPage = items.length - inactiveCount;
  return [
    {
      id: 'scope',
      label: hasFilters ? 'No recorte' : 'Carteira',
      value: total,
      scope: 'total',
      hint: hasFilters ? 'sob os filtros aplicados' : 'carteira autorizada',
      tone: 'neutral',
    },
    {
      id: 'active',
      label: 'Ativos',
      value: activeOnPage,
      scope: 'page',
      hint: 'nesta página',
      tone: 'settled',
    },
    {
      id: 'inactive',
      label: 'Fora de operação',
      value: inactiveCount,
      scope: 'page',
      hint: 'não entram em novos documentos',
      // EXCEPTION-FIRST: o recorte que trava novos documentos só ganha peso quando existe.
      tone: inactiveCount > 0 ? 'critical' : 'settled',
    },
  ];
}

/* ── hierarquia em leitura de fila ──────────────────────────────────────────────────────── */

/**
 * RÓTULO DE ESTRUTURA DO CLIENTE PARA A LINHA E O DRAWER.
 *
 * Grupo econômico e matriz são VÍNCULOS DECLARADOS. Quando não existem, o rótulo é `null` — a
 * linha simplesmente não afirma nada sobre estrutura, em vez de escrever "sem grupo", que soaria
 * como uma pendência de cadastro quando pode ser apenas um Cliente independente.
 */
export function hierarchyLabel(client: {
  groupName: string | null;
  parentClientName: string | null;
  childCount: number;
}): string | null {
  const parts: string[] = [];
  if (client.groupName) {
    parts.push(client.groupName);
  }
  if (client.parentClientName) {
    parts.push(`Matriz: ${client.parentClientName}`);
  }
  if (client.childCount > 0) {
    parts.push(`${client.childCount} ${client.childCount === 1 ? 'filial' : 'filiais'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** A árvore declara estrutura? Usado para decidir entre a árvore e o estado vazio compacto. */
export function hierarchyHasStructure(hierarchy: ClientHierarchy | null): boolean {
  if (!hierarchy) {
    return false;
  }
  return hierarchy.nodes.some((node) => node.relation === 'parent' || node.relation === 'child');
}

/* ── financeiro em leitura de fila ─────────────────────────────────────────────────────── */

export type FinancialSummaryLine = {
  label: string;
  value: string;
  tone: 'neutral' | 'critical';
};

/**
 * LINHAS FINANCEIRAS PARA LEITURA RÁPIDA.
 *
 * Só produz linhas quando o servidor AUTORIZOU e devolveu totais. `authorized: false` devolve
 * lista vazia e um sinal próprio, para a UI declarar "não autorizado" em vez de imprimir zeros.
 *
 * Zero REAL é exibido como zero — isso é um fato medido. O que nunca é exibido é zero no lugar de
 * ausência.
 */
export function buildFinancialSummary(
  context: ClientFinancialContext | null,
): { authorized: boolean; evaluated: boolean; empty: boolean; lines: FinancialSummaryLine[] } {
  if (!context) {
    return { authorized: false, evaluated: false, empty: false, lines: [] };
  }
  if (!context.authorized || context.currencies === null) {
    return { authorized: false, evaluated: context.evaluated, empty: false, lines: [] };
  }
  if (context.currencies.length === 0) {
    // Consultou e não há título. Isso É um fato e pode ser afirmado.
    return { authorized: true, evaluated: true, empty: true, lines: [] };
  }

  const lines: FinancialSummaryLine[] = [];
  for (const totals of context.currencies) {
    const money = (amount: string) => formatMoney(amount, totals.currencyCode);
    lines.push({ label: 'Em aberto', value: money(totals.openAmount), tone: 'neutral' });
    if (totals.overdueCount > 0) {
      lines.push({
        label: `Vencido (${totals.overdueCount})`,
        value: money(totals.overdueAmount),
        tone: 'critical',
      });
    }
    if (totals.nextDueDate) {
      lines.push({
        label: 'Próximo vencimento',
        value: formatDate(totals.nextDueDate),
        tone: 'neutral',
      });
    }
  }
  return { authorized: true, evaluated: true, empty: false, lines };
}

/**
 * FORMATAÇÃO DE MOEDA A PARTIR DA STRING NUMÉRICA DO SERVIDOR.
 *
 * Valores monetários chegam como `numeric` serializado em texto, e NÃO como número: convertê-los
 * para `float` no caminho perderia precisão em valores grandes. A conversão aqui é apenas para
 * APRESENTAÇÃO, e o valor original nunca é usado em cálculo no frontend.
 */
export function formatMoney(amount: string, currencyCode: string): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    return amount;
  }
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode }).format(
      parsed,
    );
  } catch {
    // Código de moeda fora do ISO que o runtime conhece: exibe o número com o código, em vez de
    // engolir o valor ou estourar a seção inteira.
    return `${parsed.toLocaleString('pt-BR')} ${currencyCode}`;
  }
}

export function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(parsed);
}

/** O Cliente tem estrutura declarada? Decide entre a seção de hierarquia e o estado compacto. */
export function hasDeclaredStructure(client: {
  groupName: string | null;
  parentClientName: string | null;
  childCount: number;
}): boolean {
  return Boolean(client.groupName) || Boolean(client.parentClientName) || client.childCount > 0;
}

/**
 * SITUAÇÕES PUBLICADAS DO CLIENTE — composição de fatos reais em uma lista curta e ordenada.
 *
 * Cada entrada só existe quando a FONTE existe. É o "Situation Handling" desta onda, e ele é
 * deliberadamente conservador: não há risco calculado, não há SLA, não há prazo derivado no
 * cliente. O que aparece é o que o backend publicou.
 *
 * São sinais reais disponíveis hoje:
 *  - situação INATIVA (persistida);
 *  - apontamentos de qualidade (avaliados pelo servidor);
 *  - vínculo hierárquico ausente NÃO entra: Cliente independente não é pendência.
 *  - financeiro entra SOMENTE quando o servidor autorizou e há título vencido.
 */
export type ClientSituation = {
  id: string;
  label: string;
  detail: string;
  tone: 'critical' | 'attention' | 'neutral';
};

export function buildClientSituations(input: {
  status: ClientStatus;
  quality: ClientDataQuality | null;
  financial: ClientFinancialContext | null;
}): ClientSituation[] {
  const situations: ClientSituation[] = [];

  if (input.status === 'INACTIVE') {
    situations.push({
      id: 'inactive',
      label: 'Fora de operação',
      detail: 'Não entra em novos documentos até ser reativado.',
      tone: 'critical',
    });
  }

  if (input.quality?.evaluated) {
    for (const finding of input.quality.findings) {
      situations.push({
        id: `quality:${finding.code}`,
        label: finding.summary,
        detail: finding.consequence,
        tone: finding.severity === 'blocking' ? 'critical' : 'attention',
      });
    }
  }

  /*
   * FINANCEIRO SÓ QUANDO AUTORIZADO E COM VENCIDO REAL.
   *
   * `authorized: false` não gera situação: o operador não pode ver o dado, e transformar isso em
   * alerta seria afirmar um problema financeiro a partir de uma NEGAÇÃO de acesso. Ausência de
   * permissão não é evidência de inadimplência.
   */
  if (input.financial?.authorized && input.financial.currencies) {
    for (const totals of input.financial.currencies) {
      if (totals.overdueCount > 0) {
        situations.push({
          id: `financial:overdue:${totals.currencyCode}`,
          label: `${totals.overdueCount} título${totals.overdueCount === 1 ? '' : 's'} vencido${totals.overdueCount === 1 ? '' : 's'}`,
          detail: `${formatMoney(totals.overdueAmount, totals.currencyCode)} em atraso.`,
          tone: 'critical',
        });
      }
    }
  }

  return situations;
}

/** Contagem de situações por tom, para o cabeçalho. Sobre a lista REAL, não sobre amostra. */
export function countSituations(situations: ClientSituation[]): {
  critical: number;
  attention: number;
} {
  return {
    critical: situations.filter((s) => s.tone === 'critical').length,
    attention: situations.filter((s) => s.tone === 'attention').length,
  };
}

/** Estável para uso em dependências de efeito. */
export function useStableList<T>(items: T[]): T[] {
  return useMemo(() => items, [items]);
}
