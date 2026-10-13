import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import { domainReachesFinance, domainReachesOperation } from './dashboard-semantics';

/**
 * KPI STRIP DO WORKSPACE — indicadores ACIONAVEIS, na faixa que abre a area de trabalho.
 *
 * DIFERENCA PARA `buildDashboardKpis` (que continua existindo e alimenta o painel analitico):
 * aquele constroi indicadores de DESCRICAO, inclusive taxas sem lista de destino. Este constroi
 * apenas o que o operador pode PERSEGUIR: todo indicador daqui tem `href` para o recorte que o
 * produziu. Indicador sem drill nao entra — numero sem destino e decoracao.
 *
 * REGRAS DE HONESTIDADE APLICADAS:
 *   - contagem ausente NAO vira zero (o indicador simplesmente nao existe);
 *   - o recorte de dominio e respeitado: dimensao que o recorte nao alcanca nao e exibida;
 *   - nenhum valor e somado, multiplicado ou projetado entre metricas distintas.
 */

export type WorkbenchKpiTone = 'neutral' | 'info' | 'warning' | 'critical' | 'success';

export type WorkbenchKpi = {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  context: string;
  href: string;
  ariaLabel: string;
  tone: WorkbenchKpiTone;
};

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Contexto do indicador — SEMPRE nomeia o recorte que o numero cobre.
 *
 * Um numero de atraso sem escopo declarado e um numero que o operador nao pode usar: ele nao sabe
 * se esta olhando a empresa ou a carteira de uma unidade.
 */
function overdueContext(maxDelayDays: number | null | undefined, scope: string): string {
  if (maxDelayDays === null || maxDelayDays === undefined) {
    return `Prazo vencido · ${scope}`;
  }
  return `Maior atraso: ${maxDelayDays} ${plural(maxDelayDays, 'dia', 'dias')} · ${scope}`;
}

/**
 * INDICADORES DO WORKSPACE — ordem de decisao: primeiro o que esta vencido, depois o que esta
 * parado, depois o que esta em andamento. Volume de OS nunca abre a faixa sozinho.
 */
export function buildWorkbenchKpis(
  snapshot: ExecutiveDashboardSnapshot,
  domain: string | null,
): WorkbenchKpi[] {
  const kpis: WorkbenchKpi[] = [];
  const attention = (id: string) => snapshot.attention.find((item) => item.id === id);
  const operationScope = domain === null ? 'no escopo autorizado' : 'no recorte selecionado';

  /* ---- ATRASO FINANCEIRO: so no recorte que alcanca a carteira ------------------------------ */
  if (snapshot.visibility.billing && snapshot.charts.financialAging.available && domainReachesFinance(domain)) {
    const overdue = attention('overdue-receivables');
    if (overdue && overdue.count > 0) {
      kpis.push({
        id: 'overdue-receivables',
        label: 'Recebíveis vencidos',
        value: String(overdue.count),
        unit: plural(overdue.count, 'título', 'títulos'),
        context: overdue.detail ?? 'Vencimento ultrapassado e saldo em aberto',
        href: overdue.href ?? '/app/finance/receivables?status=OVERDUE',
        ariaLabel: `Recebíveis vencidos: ${overdue.count} ${plural(overdue.count, 'título', 'títulos')}. Abrir títulos vencidos.`,
        tone: 'critical',
      });
    }
  }

  /* ---- ATRASO OPERACIONAL: so no recorte que alcanca as ordens ------------------------------ */
  if (snapshot.visibility.serviceOrders && domainReachesOperation(domain)) {
    const overdue = attention('overdue-service-orders');
    if (overdue && overdue.count > 0) {
      kpis.push({
        id: 'overdue-service-orders',
        label: 'Ordens vencidas',
        value: String(overdue.count),
        unit: plural(overdue.count, 'ordem', 'ordens'),
        context: overdueContext(overdue.maxDelayDays, operationScope),
        href: overdue.href ?? '/app/service-orders?filter=overdue',
        ariaLabel: `Ordens de serviço vencidas: ${overdue.count} ${plural(overdue.count, 'ordem', 'ordens')}. Abrir ordens vencidas.`,
        tone: 'critical',
      });
    }

    const approaching = attention('approaching-due-service-orders');
    if (approaching && approaching.count > 0) {
      kpis.push({
        id: 'approaching-due-service-orders',
        label: 'Ordens vencendo',
        value: String(approaching.count),
        unit: plural(approaching.count, 'ordem', 'ordens'),
        context: `Prazo nos próximos dias · ${operationScope}`,
        href: approaching.href ?? '/app/service-orders?filter=approaching-due',
        ariaLabel: `Ordens de serviço vencendo: ${approaching.count} ${plural(approaching.count, 'ordem', 'ordens')}. Abrir ordens a vencer.`,
        tone: 'warning',
      });
    }
  }

  /* ---- MEDICAO PARADA ------------------------------------------------------------------------ */
  if (snapshot.visibility.measurements && domainReachesOperation(domain)) {
    const pending = attention('pending-measurements');
    if (pending && pending.count > 0) {
      kpis.push({
        id: 'pending-measurements',
        label: 'Medições paradas',
        value: String(pending.count),
        unit: plural(pending.count, 'medição', 'medições'),
        context: 'Aguardando análise ou aprovação',
        href: pending.href ?? '/app/billing',
        ariaLabel: `Medições aguardando aprovação: ${pending.count}. Abrir fila de faturamento.`,
        tone: 'warning',
      });
    }
  }

  /* ---- VOLUME EM ANDAMENTO ------------------------------------------------------------------- */
  if (snapshot.visibility.serviceOrders && domainReachesOperation(domain)) {
    const active = snapshot.charts.serviceOrdersByStatus.items.reduce(
      (total, item) => total + item.count,
      0,
    );
    if (active > 0) {
      kpis.push({
        id: 'active-service-orders',
        label: 'Ordens em andamento',
        value: String(active),
        unit: plural(active, 'ordem', 'ordens'),
        context: `Distribuição atual por situação · ${operationScope}`,
        href: '/app/service-orders?status=active',
        ariaLabel: `Ordens de serviço em andamento: ${active} ${plural(active, 'ordem', 'ordens')}. Abrir ordens ativas.`,
        tone: 'info',
      });
    }
  }

  return kpis;
}
