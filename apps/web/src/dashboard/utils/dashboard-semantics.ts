import type { ExecutiveAttentionItem, ExecutiveDashboardSnapshot } from '../types/dashboard.types';

/**
 * SEMANTICA DE APRESENTACAO DO PAINEL EXECUTIVO.
 *
 * Esta camada NAO calcula metrica, NAO deriva regra e NAO reclassifica dado do
 * servidor: ela apenas responde "onde clicar" e "como nomear o numero que o
 * servidor ja entregou". Todo valor exibido vem do snapshot composto unico
 * (`GET /dashboard/executive`); nada aqui le outra fonte.
 *
 * Regras de honestidade aplicadas:
 *  - destino so existe quando a LISTA de destino realmente interpreta o recorte;
 *  - ausencia de destino nao vira link generico de modulo: vira `null` e a
 *    excecao continua sendo exibida sem prometer navegacao;
 *  - nada e multiplicado, somado ou projetado entre metricas distintas.
 *
 * Confirmado no codigo da lista de destino (`finance/pages/ReceivablesListPage.tsx`): o
 * parametro lido da URL e `status`. Os destinos de recebiveis NOMEIAM esse parametro — antes
 * ele era omitido e o link abria a carteira inteira: um drill que nao entrega o proprio
 * recorte e um numero que mente.
 */

export type SeverityTone = 'critical' | 'warning' | 'info';

export const DASHBOARD_SEVERITY_TONE: Record<ExecutiveAttentionItem['severity'], SeverityTone> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

const SEVERITY_RANK: Record<ExecutiveAttentionItem['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Excecoes ordenadas por severidade e, dentro dela, por volume. */
export function sortAttentionBySeverity(items: ExecutiveAttentionItem[]): ExecutiveAttentionItem[] {
  return [...items].sort((left, right) => {
    const delta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (delta !== 0) {
      return delta;
    }
    return right.count - left.count;
  });
}

/** Frase de situacao lida na FILA EXECUTIVA, por severidade real do item. */
export function attentionSituationLabel(severity: ExecutiveAttentionItem['severity']): string {
  return severity === 'critical' ? 'Crítico' : severity === 'warning' ? 'Atenção' : 'Acompanhar';
}

/** Ordem em que as situacoes aparecem no resumo da fila executiva. */
export const ATTENTION_SITUATION_ORDER: ReadonlyArray<ExecutiveAttentionItem['severity']> = [
  'critical',
  'warning',
  'info',
];

/**
 * TETO DO DINHEIRO EM ATRASO — EXIBIDO SOMENTE QUANDO O VALOR E COMPROVADO.
 *
 * `receivables.overdue_amount` e metrica CONFIRMED do catalogo SMC-001 e o
 * serializer executivo ja a calcula. O unico valor monetario de atraso publicado
 * no snapshot hoje e a exposicao dos faturamentos vencidos, que chega no `detail`
 * do item de atencao `overdue-receivables` no MESMO evento de render — logo o
 * rotulo nunca aparece sem o numero ao lado.
 *
 * Enquanto `receivables.overdue_amount` nao existir como campo de primeira classe
 * do snapshot, NAO se soma o aging por faixa para "reconstruir" o total: isso
 * seria derivar metrica no navegador.
 */
export function extractOverdueExposure(item: ExecutiveAttentionItem | undefined): string | null {
  if (!item?.detail) {
    return null;
  }
  const matched = item.detail.match(/R\$\s*[\d.,]+/);
  return matched ? matched[0] : null;
}

/**
 * PROCESS RAIL — cadeia empresarial Comercial -> Operacao -> Medicao -> Faturamento -> Recebimento.
 *
 * Cada etapa e alimentada por um FATO DIFERENTE, ja resolvido pelo servidor na cadeia real do
 * dominio (`CLIENTE -> SOLICITACAO -> PROPOSTA -> PO -> OS -> EXECUCAO -> MEDICAO -> FATURAMENTO
 * -> RECEBIVEL`). Nenhuma etapa soma outra etapa.
 *
 * duas naturezas de etapa, e a diferenca importa:
 *  - `count` numerico   = o snapshot publicou a contagem daquela etapa;
 *  - `count: null`      = o snapshot publicou o estado da etapa SEM contagem. A etapa existe,
 *                         esta nomeada e continua na cadeia; o que nao existe e o numero.
 *
 * `count: null` NUNCA e renderizado como zero: ausencia nao e zero.
 */
export type BusinessFlowStage = {
  id: string;
  label: string;
  /** Contagem real publicada; `null` quando a etapa nao tem contagem publicada. */
  count: number | null;
  amount: string | null;
  situation: 'critical' | 'attention' | 'normal';
  /** Estado dominante da etapa, em linguagem de negocio. */
  situationLabel: string;
  href: string | null;
  /** Fato que ancora a etapa — nunca uma promessa de funcionalidade. */
  hint: string;
};

/**
 * DESTINOS DE DRILL — apenas recortes que a lista de destino comprovadamente
 * interpreta hoje. O modulo AUTHZ permanece intacto: quem revalida capability,
 * escopo e unidade e a propria lista de destino, nunca a URL.
 */
export const DASHBOARD_DRILL_DESTINATIONS = {
  'service-orders-active': '/app/service-orders?status=active',
  'orders-in-progress': '/app/service-orders?status=IN_EXECUTION',
  'orders-awaiting-release': '/app/service-orders?status=RELEASED',
  'measurements-pending': '/app/billing',
  'awaiting-billing': '/app/billing',
  'receivables-overdue': '/app/finance/receivables?status=OVERDUE',
  'receivables-open': '/app/finance/receivables?status=OPEN',
  'receivables-partial': '/app/finance/receivables?status=PARTIALLY_PAID',
  'payables-overdue': '/app/finance/payables?status=OVERDUE',
} as const;

export type DashboardDrillId = keyof typeof DASHBOARD_DRILL_DESTINATIONS;

export function drillHref(id: DashboardDrillId): string {
  return DASHBOARD_DRILL_DESTINATIONS[id];
}

function drillHrefIfKnown(id: string): string | null {
  return id in DASHBOARD_DRILL_DESTINATIONS
    ? DASHBOARD_DRILL_DESTINATIONS[id as DashboardDrillId]
    : null;
}

/**
 * Drill do item de atencao: o `href` do servidor tem precedencia (contrato
 * FDC-001); quando ausente, o recorte e resolvido por identidade conhecida.
 * Item sem lista filtrada real devolve `null` — a tela nao inventa modulo.
 */
export function attentionDrillHref(item: ExecutiveAttentionItem): string | null {
  return item.href ?? drillHrefIfKnown(item.id);
}

function attentionCount(snapshot: ExecutiveDashboardSnapshot, id: string): number {
  return snapshot.attention.find((item) => item.id === id)?.count ?? 0;
}

/**
 * CADEIA EMPRESARIAL DO PAINEL.
 *
 * Ordem de negocio fixa: Comercial -> Operacao -> Medicao -> Faturamento -> Recebimento. Uma etapa
 * entra na cadeia quando o fato dela foi publicado; etapa sem fato nao e afirmada nem ocupa lugar.
 * Etapa cuja contagem nao veio continua na cadeia com o estado publicado e `count: null`.
 *
 * `domain` e RECORTE DE APRESENTACAO: ele apenas seleciona quais etapas da MESMA cadeia ficam em
 * foco. Nunca altera contagem, nunca soma etapa e nunca cria etapa que o servidor nao publicou.
 */
export function buildBusinessFlow(
  snapshot: ExecutiveDashboardSnapshot,
  domain: string | null = null,
): BusinessFlowStage[] {
  const visibility = snapshot.visibility;
  const overdueOrders = attentionCount(snapshot, 'overdue-service-orders');
  const activeOrders = snapshot.charts.serviceOrdersByStatus.items.reduce(
    (total, item) => total + item.count,
    0,
  );
  const stages: BusinessFlowStage[] = [];

  if (visibility.serviceOrders) {
    stages.push({
      id: 'operation',
      label: 'Operação',
      count: activeOrders,
      amount: null,
      situation: overdueOrders > 0 ? 'critical' : 'normal',
      situationLabel:
        overdueOrders > 0
          ? `${overdueOrders} ${overdueOrders === 1 ? 'ordem vencida' : 'ordens vencidas'}`
          : 'Nenhuma ordem vencida',
      href: DASHBOARD_DRILL_DESTINATIONS['service-orders-active'],
      hint: 'Ordens de serviço ativas no escopo autorizado',
    });
  }

  if (visibility.measurements && (domain === null || domain === 'OPERACOES')) {
    const pending = attentionCount(snapshot, 'pending-measurements');
    stages.push({
      id: 'measurement',
      label: 'Medição',
      count: pending,
      amount: null,
      situation: pending > 0 ? 'attention' : 'normal',
      situationLabel: pending > 0 ? 'Aguardando aprovação' : 'Nenhuma parada',
      href: pending > 0 ? DASHBOARD_DRILL_DESTINATIONS['measurements-pending'] : null,
      hint: 'Medições aguardando análise ou aprovação',
    });
  }

  if (visibility.billing && (domain === null || domain === 'FINANCEIRO')) {
    /*
     * FATURAMENTO — o executor publica o FATO da etapa sem contagem. A etapa permanece visivel
     * como estagio real da cadeia; nenhum numero e estimado no lugar dela.
     */
    stages.push({
      id: 'billing',
      label: 'Faturamento',
      count: null,
      amount: null,
      situation: 'normal',
      situationLabel: 'Sem contagem publicada',
      href: DASHBOARD_DRILL_DESTINATIONS['awaiting-billing'],
      hint: 'Cobrança preparada a partir da medição aprovada',
    });

    const overdueReceivables = attentionCount(snapshot, 'overdue-receivables');
    const exposure = extractOverdueExposure(
      snapshot.attention.find((item) => item.id === 'overdue-receivables'),
    );
    stages.push({
      id: 'receivement',
      label: 'Recebimento',
      count: overdueReceivables,
      amount: exposure,
      situation: overdueReceivables > 0 ? 'critical' : 'normal',
      situationLabel:
        overdueReceivables > 0
          ? `${overdueReceivables} ${overdueReceivables === 1 ? 'título vencido' : 'títulos vencidos'}`
          : 'Nenhum título vencido',
      href: DASHBOARD_DRILL_DESTINATIONS['receivables-overdue'],
      hint: 'Títulos emitidos e não liquidados',
    });
  }

  return stages;
}

/**
 * ETAPAS DO PAINEL QUE NAO SAO EXCECAO OPERACIONAL.
 *
 * `divergences` e a unica excecao que fala de CONTEUDO do documento (medição rejeitada ou
 * faturamento anulado), nao de prazo. Ela aparece na cadeia, junto do estagio que a produz —
 * e nao duas vezes na fila de trabalho.
 */
export const DASHBOARD_CHAIN_ONLY_ATTENTION = ['divergences'] as const;
