import type { ExecutiveDashboardSnapshot } from '../dashboard/types/dashboard.types';
import { requestUrl } from './request-url';

export const EXECUTIVE_DASHBOARD_SNAPSHOT: ExecutiveDashboardSnapshot = {
  generatedAt: '2026-08-29T12:00:00.000Z',
  businessTimezone: 'America/Porto_Velho',
  period: { preset: 'week', from: '2026-08-23', to: '2026-08-29' },
  visibility: {
    serviceRequests: true,
    serviceOrders: true,
    measurements: true,
    billing: true,
    documents: false,
    resources: true,
    productivity: true,
    financialAging: true,
  },
  attention: [
    {
      id: 'overdue-service-orders',
      label: 'OS vencidas',
      count: 3,
      severity: 'critical',
      href: '/app/service-orders?filter=overdue',
      ariaLabel: 'OS vencidas: 3 itens. Maior atraso 8 dias.',
      maxDelayDays: 8,
      detail: 'Maior atraso: 8 dia(s)',
    },
    {
      id: 'pending-measurements',
      label: 'Medições paradas',
      count: 2,
      severity: 'warning',
      href: '/app/billing',
      ariaLabel: 'Medições paradas: 2 itens',
      maxDelayDays: null,
      detail: 'Aguardando análise ou aprovação',
    },    {
      id: 'overdue-receivables',
      label: 'Faturamentos vencidos',
      count: 2,
      severity: 'critical',
      href: '/app/finance/receivables?status=OVERDUE',
      ariaLabel: 'Faturamentos vencidos: 2 itens',
      maxDelayDays: null,
      detail: 'Exposição: R$ 800.00',
    },
  ],
  charts: {
    serviceOrdersByStatus: {
      title: 'OS por status',
      description: 'Distribuição atual de ordens de serviço no escopo autorizado.',
      items: [
        { status: 'IN_EXECUTION', label: 'Em execução', count: 4 },
        { status: 'RELEASED', label: 'Liberada', count: 2 },
      ],
      summary: '6 ordens de serviço ativas no escopo.',
    },
    throughputTrend: {
      title: 'Evolução temporal',
      description: 'Série diária de OS abertas e concluídas no período selecionado.',
      points: [
        { date: '2026-08-28', opened: 2, completed: 1 },
        { date: '2026-08-29', opened: 1, completed: 3 },
      ],
      summary: '3 abertas e 4 concluídas no período.',
    },
    sla: {
      title: 'SLA de conclusão',
      description: 'Conclusões dentro e fora do prazo por semana.',
      points: [
        { periodLabel: '2026-S35', onTime: 2, overdue: 1, eligible: 3, onTimeRate: 2 / 3 },
      ],
      summary: '2 de 3 conclusões elegíveis no prazo (66.7%).',
    },
    financialAging: {
      available: true,
      title: 'Aging financeiro',
      description: 'Recebíveis vencidos por faixa configurada.',
      buckets: [
        { bandId: '0-7', label: '0–7 dias', count: 1, totalAmount: '500.00' },
        { bandId: '8-15', label: '8–15 dias', count: 1, totalAmount: '300.00' },
      ],
      summary: '2 recebíveis vencidos.',
    },
  },
  productivity: {
    completed: 10,
    onTimeRate: { value: 0.8, numerator: 8, denominator: 10, available: true },
    averageCycleTime: { valueHours: 24, sampleSize: 10, available: true },
    reworkRate: {
      value: 0.1,
      numerator: 1,
      denominator: 10,
      available: true,
      concept: 'measurement_rejection_rate',
    },
    utilization: {
      value: 0.5,
      numerator: 5,
      denominator: 10,
      available: true,
      concept: 'allocated_window_over_planned_window',
    },
    evidenceCompleteness: { value: 0.9, numerator: 9, denominator: 10, available: true },
    measurementAcceptance: { value: 0.85, numerator: 17, denominator: 20, available: true },
  },
  shortcuts: [
    {
      id: 'shortcut-requests',
      label: 'Solicitações',
      href: '/app/requests',
      ariaLabel: 'Ir para solicitações de serviço',
    },
  ],
};

/**
 * TITULOS VENCIDOS — recorte consumido pela carteira
 * (/app/finance/receivables?status=OVERDUE), no formato de resposta do modulo.
 */
const OVERDUE_RECEIVABLE_TITLES = [
  {
    id: '33333333-3333-4333-8333-333333333331',
    externalReference: 'NF-1042',
    originKind: 'BILLING_DOCUMENT',
    originId: '44444444-4444-4444-8444-444444444441',
    unitId: 'unit-1',
    clientId: null,
    principal: '800.00',
    currencyCode: 'BRL',
    dueDate: '2026-08-10',
    lifecycle: 'ACTIVE',
    status: 'OVERDUE',
    remainingBalance: '800.00',
    rowVersion: 1,
    createdAt: '2026-07-10T12:00:00.000Z',
    installments: [],
    settlements: [],
  },
];

export function createDashboardFetchMock() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/api/v1/auth/login') && method === 'POST') {
      return new Response(
        JSON.stringify({
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 900,
          session: { id: 'session-dashboard', expiresAt: new Date().toISOString(), status: 'active' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/api/v1/auth/session') && method === 'GET') {
      return new Response(
        JSON.stringify({
          identityId: '11111111-1111-4111-8111-111111111111',
          session: { id: 'session-dashboard', expiresAt: new Date().toISOString(), status: 'active' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/api/v1/alerts/summary') && method === 'GET') {
      return new Response(JSON.stringify({ activeCount: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/v1/alerts') && method === 'GET') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/v1/dashboard/executive') && method === 'GET') {
      return new Response(JSON.stringify(EXECUTIVE_DASHBOARD_SNAPSHOT), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // CARTEIRA DE TITULOS — o drilldown financeiro do painel aponta para
    // /app/finance/receivables?status=OVERDUE; sem a rota o clique no KPI nao era
    // verificavel ponta a ponta. Contrato canonico { items, limit, offset, total,
    // totalPages }, honrando o recorte status.
    if (url.includes('/api/v1/finance/receivables') && method === 'GET') {
      const status = new URL(url, 'http://localhost').searchParams.get('status');
      const matched = status
        ? OVERDUE_RECEIVABLE_TITLES.filter((item) => item.status === status)
        : OVERDUE_RECEIVABLE_TITLES;
      return new Response(
        JSON.stringify({
          items: matched,
          limit: matched.length,
          offset: 0,
          total: matched.length,
          totalPages: matched.length > 0 ? 1 : 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/api/v1/requests/service-requests') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ code: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
