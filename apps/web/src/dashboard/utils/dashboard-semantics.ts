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
 *  - ausencia de destino nao vira link generico de modulo: vira `null` e a tela
 *    declara a ausencia (PARK_BI_GAP no relatorio da wave);
 *  - nada e multiplicado, somado ou projetado entre metricas distintas.
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
 * do snapshot (PARK_BI_GAP), NAO se soma o aging por faixa para "reconstruir" o
 * total: isso seria derivar metrica no navegador.
 */
export function extractOverdueExposure(item: ExecutiveAttentionItem | undefined): string | null {
  if (!item?.detail) {
    return null;
  }
  const matched = item.detail.match(/R\$\s*[\d.,]+/);
  return matched ? matched[0] : null;
}

/** Cadeia comercial/operacional/financeira — etapa so aparece com dado real. */
export type BusinessFlowStage = {
  id: string;
  label: string;
  count: number | null;
  amount: string | null;
  situation: 'critical' | 'attention' | 'normal';
  situationLabel: string;
  href: string | null;
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

function stage(
  id: string,
  label: string,
  count: number,
  href: string | null,
  hint: string,
): BusinessFlowStage {
  return {
    id,
    label,
    count,
    amount: null,
    situation: count > 0 ? 'attention' : 'normal',
    situationLabel: count > 0 ? 'em andamento' : 'sem pendência',
    href,
    hint,
  };
}

/**
 * Cada etapa le um campo DIFERENTE e ja resolvido do snapshot. Nenhuma etapa e
 * calculada somando outras etapas, e nenhuma lista e chamada de "pipeline".
 */
export function buildBusinessFlow(snapshot: ExecutiveDashboardSnapshot): BusinessFlowStage[] {
  const visibility = snapshot.visibility;
  const stages: BusinessFlowStage[] = [];

  if (visibility.serviceOrders) {
    const active = snapshot.charts.serviceOrdersByStatus.items.reduce(
      (total, item) => total + item.count,
      0,
    );
    stages.push(
      stage(
        'service-orders',
        'Ordens de serviço',
        active,
        DASHBOARD_DRILL_DESTINATIONS['service-orders-active'],
        'OS ativas no escopo autorizado',
      ),
    );
    stages.push(
      stage(
        'in-execution',
        'Em execução',
        snapshot.charts.serviceOrdersByStatus.items
          .filter((item) => item.status === 'IN_EXECUTION' || item.status === 'PAUSED')
          .reduce((total, item) => total + item.count, 0),
        DASHBOARD_DRILL_DESTINATIONS['orders-in-progress'],
        'Trabalho em campo agora',
      ),
    );
  }

  if (visibility.measurements) {
    stages.push(
      stage(
        'measurements',
        'Medições a aprovar',
        attentionCount(snapshot, 'pending-measurements'),
        drillHrefIfKnown('pending-measurements'),
        'Aguardando análise ou aprovação',
      ),
    );
  }

  if (visibility.billing) {
    stages.push({
      id: 'awaiting-billing',
      label: 'Aguardando faturamento',
      count: attentionCount(snapshot, 'pending-billing'),
      amount: null,
      situation: 'attention',
      situationLabel: 'exige preparação',
      href: DASHBOARD_DRILL_DESTINATIONS['awaiting-billing'],
      hint: 'OS concluídas sem cobrança preparada',
    });

    stages.push({
      id: 'receivables-overdue',
      label: 'Recebíveis vencidos',
      count: attentionCount(snapshot, 'overdue-receivables'),
      amount: extractOverdueExposure(
        snapshot.attention.find((item) => item.id === 'overdue-receivables'),
      ),
      situation: 'critical',
      situationLabel: 'exposição',
      href: DASHBOARD_DRILL_DESTINATIONS['receivables-overdue'],
      hint: 'Título vencido e não liquidado',
    });
  }

  return stages;
}
