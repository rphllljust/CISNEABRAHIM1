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
  /**
   * METRICA DO CONTRATO SEM VALOR PUBLICADO PARA O RECORTE.
   *
   * A celula continua na faixa com `value: '—'` e este flag ligado. E a diferenca entre
   * "nao publicado" e "zero": o servidor nao afirmou ausencia, entao a tela tambem nao pode.
   *
   * AUSENCIA != ZERO — mas AUSENCIA TAMBEM NAO DESMONTA A FAIXA. Uma faixa que encolhe para tres
   * celulas porque o recorte nao publicou quatro metricas faz o cockpit parecer quebrado; o operador
   * precisa reconhecer a MESMA estrutura de indicadores em todo recorte, com o estado honesto dito
   * em cada celula.
   */
  unmeasured: boolean;
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
 * INDICADORES DO WORKSPACE — ESTRUTURA ESTAVEL, ESTADO HONESTO.
 *
 * A faixa publica SEMPRE as mesmas celulas do contrato do painel, na ordem de decisao: vencido
 * (financeiro e operacional), a vencer, medicao parada e volume em andamento. O que varia por
 * recorte e o ESTADO de cada celula, nao a existencia dela:
 *
 *   valor publicado            -> numero real + drilldown para a lista que o produziu;
 *   metrica nao publicada      -> `—` + "não publicado neste recorte", sem drill (nao ha lista);
 *   fora do dominio do recorte -> `—` + "fora do recorte ativo".
 *
 * Antes, metrica nao publicada simplesmente NAO ENTRAVA — e a faixa encolhia de cinco para tres
 * celulas conforme o recorte, o que fazia o cockpit parecer quebrado e escondia do operador quais
 * indicadores existem. AUSENCIA != ZERO, mas ausencia tambem nao e motivo para desmontar a faixa.
 */
export function buildWorkbenchKpis(
  snapshot: ExecutiveDashboardSnapshot,
  domain: string | null,
): WorkbenchKpi[] {
  const kpis: WorkbenchKpi[] = [];
  const attention = (id: string) => snapshot.attention.find((item) => item.id === id);
  const operationScope = domain === null ? 'no escopo autorizado' : 'no recorte selecionado';
  const operationInScope = domainReachesOperation(domain);
  const financeInScope = domainReachesFinance(domain);
  const outOfScope = 'Fora do recorte ativo';

  /* ---- ATRASO FINANCEIRO --------------------------------------------------------------------- */
  {
    const overdue = financeInScope ? attention('overdue-receivables') : undefined;
    const measured = financeInScope && snapshot.visibility.billing &&
      snapshot.charts.financialAging.available && overdue !== undefined && overdue.count > 0;
    kpis.push(
      measured
        ? {
            id: 'overdue-receivables',
            label: 'Recebíveis vencidos',
            value: String(overdue.count),
            unit: plural(overdue.count, 'título', 'títulos'),
            context: overdue.detail ?? 'Vencimento ultrapassado e saldo em aberto',
            href: overdue.href ?? '/app/finance/receivables?status=OVERDUE',
            ariaLabel: `Recebíveis vencidos: ${overdue.count} ${plural(overdue.count, 'título', 'títulos')}. Abrir títulos vencidos.`,
            tone: 'critical',
            unmeasured: false,
          }
        : {
            id: 'overdue-receivables',
            label: 'Recebíveis vencidos',
            value: '—',
            unit: null,
            context: financeInScope ? 'Não publicado neste recorte' : outOfScope,
            href: '/app/finance/receivables?status=OVERDUE',
            ariaLabel: 'Recebíveis vencidos: não publicado neste recorte.',
            tone: 'neutral',
            unmeasured: true,
          },
    );
  }

  /* ---- ATRASO OPERACIONAL -------------------------------------------------------------------- */
  {
    const overdue = operationInScope ? attention('overdue-service-orders') : undefined;
    const measured = snapshot.visibility.serviceOrders && overdue !== undefined && overdue.count > 0;
    kpis.push(
      measured
        ? {
            id: 'overdue-service-orders',
            label: 'Ordens vencidas',
            value: String(overdue.count),
            unit: plural(overdue.count, 'ordem', 'ordens'),
            context: overdueContext(overdue.maxDelayDays, operationScope),
            href: overdue.href ?? '/app/service-orders?filter=overdue',
            ariaLabel: `Ordens de serviço vencidas: ${overdue.count} ${plural(overdue.count, 'ordem', 'ordens')}. Abrir ordens vencidas.`,
            tone: 'critical',
            unmeasured: false,
          }
        : {
            id: 'overdue-service-orders',
            label: 'Ordens vencidas',
            value: '—',
            unit: null,
            context: operationInScope ? 'Não publicado neste recorte' : outOfScope,
            href: '/app/service-orders?filter=overdue',
            ariaLabel: 'Ordens de serviço vencidas: não publicado neste recorte.',
            tone: 'neutral',
            unmeasured: true,
          },
    );
  }

  /* ---- A VENCER ------------------------------------------------------------------------------ */
  {
    const approaching = operationInScope ? attention('approaching-due-service-orders') : undefined;
    const measured =
      snapshot.visibility.serviceOrders && approaching !== undefined && approaching.count > 0;
    kpis.push(
      measured
        ? {
            id: 'approaching-due-service-orders',
            label: 'Ordens vencendo',
            value: String(approaching.count),
            unit: plural(approaching.count, 'ordem', 'ordens'),
            context: `Prazo nos próximos dias · ${operationScope}`,
            href: approaching.href ?? '/app/service-orders?filter=approaching-due',
            ariaLabel: `Ordens de serviço vencendo: ${approaching.count} ${plural(approaching.count, 'ordem', 'ordens')}. Abrir ordens a vencer.`,
            tone: 'warning',
            unmeasured: false,
          }
        : {
            id: 'approaching-due-service-orders',
            label: 'Ordens vencendo',
            value: '—',
            unit: null,
            context: operationInScope ? 'Não publicado neste recorte' : outOfScope,
            href: '/app/service-orders?filter=approaching-due',
            ariaLabel: 'Ordens de serviço vencendo: não publicado neste recorte.',
            tone: 'neutral',
            unmeasured: true,
          },
    );
  }

  /* ---- MEDICAO PARADA ------------------------------------------------------------------------ */
  {
    const pending = operationInScope ? attention('pending-measurements') : undefined;
    const measured = snapshot.visibility.measurements && pending !== undefined && pending.count > 0;
    kpis.push(
      measured
        ? {
            id: 'pending-measurements',
            label: 'Medições paradas',
            value: String(pending.count),
            unit: plural(pending.count, 'medição', 'medições'),
            context: 'Aguardando análise ou aprovação',
            href: pending.href ?? '/app/billing',
            ariaLabel: `Medições aguardando aprovação: ${pending.count}. Abrir fila de faturamento.`,
            tone: 'warning',
            unmeasured: false,
          }
        : {
            id: 'pending-measurements',
            label: 'Medições paradas',
            value: '—',
            unit: null,
            context: operationInScope ? 'Não publicado neste recorte' : outOfScope,
            href: '/app/billing',
            ariaLabel: 'Medições paradas: não publicado neste recorte.',
            tone: 'neutral',
            unmeasured: true,
          },
    );
  }

  /* ---- VOLUME EM ANDAMENTO ------------------------------------------------------------------- */
  {
    const active = snapshot.charts.serviceOrdersByStatus.items.reduce(
      (total, item) => total + item.count,
      0,
    );
    const measured = snapshot.visibility.serviceOrders && operationInScope && active > 0;
    kpis.push(
      measured
        ? {
            id: 'active-service-orders',
            label: 'Ordens em andamento',
            value: String(active),
            unit: plural(active, 'ordem', 'ordens'),
            context: `Distribuição atual por situação · ${operationScope}`,
            href: '/app/service-orders?status=active',
            ariaLabel: `Ordens de serviço em andamento: ${active} ${plural(active, 'ordem', 'ordens')}. Abrir ordens ativas.`,
            tone: 'info',
            unmeasured: false,
          }
        : {
            id: 'active-service-orders',
            label: 'Ordens em andamento',
            value: '—',
            unit: null,
            context: operationInScope ? 'Não publicado neste recorte' : outOfScope,
            href: '/app/service-orders?status=active',
            ariaLabel: 'Ordens de serviço em andamento: não publicado neste recorte.',
            tone: 'neutral',
            unmeasured: true,
          },
    );
  }

  return kpis;
}
