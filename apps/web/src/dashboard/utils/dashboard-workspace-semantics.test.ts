import { describe, expect, it } from 'vitest';
import {
  buildOperationalSituation,
  situationBadgeLabel,
} from './dashboard-situation';
import {
  buildBusinessFlow,
  domainReachesFinance,
  domainReachesOperation,
  scopedAttention,
} from './dashboard-semantics';
import { buildWorkbenchKpis } from './build-workbench-kpis';
import { EXECUTIVE_DASHBOARD_SNAPSHOT } from '../../test/dashboard-fetch-mock';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';

/**
 * SEMANTICA DO WORKSPACE OPERACIONAL.
 *
 * O que este arquivo prova, e nada alem disso:
 *  - AUSENCIA != ZERO no recorte de dominio (excecao nao publicada NAO vira "operacao normal");
 *  - o recorte de dominio e respeitado por indicador, cadeia e analise;
 *  - nenhum numero e inventado, somado ou projetado;
 *  - `unknown` nunca e apresentado como estado verde.
 */

function withoutAttention(id: string): ExecutiveDashboardSnapshot {
  return {
    ...EXECUTIVE_DASHBOARD_SNAPSHOT,
    attention: EXECUTIVE_DASHBOARD_SNAPSHOT.attention.filter((item) => item.id !== id),
  };
}

describe('situation handling', () => {
  it('reports critical when the server published critical exceptions in scope', () => {
    const snapshot = EXECUTIVE_DASHBOARD_SNAPSHOT;
    const situation = buildOperationalSituation(snapshot, scopedAttention(snapshot, null));

    expect(situation.level).toBe('critical');
    expect(situation.criticalCount).toBe(2);
    expect(situation.title).toMatch(/2 exceções críticas/);
    expect(situationBadgeLabel(situation)).toBe('Ação imediata');
  });

  it('reports unknown — never normal — when the recorte reaches an exception the server never published', () => {
    /*
     * OPERACOES alcanca tres fontes de excecao: OS vencidas, OS a vencer e medicoes paradas. Aqui o
     * snapshot publica APENAS `pending-measurements` (que e warning) e nao publica as duas de prazo.
     *
     * O nivel e `warning` porque o fato CONHECIDO tem precedencia sobre a lacuna — mas o texto e
     * obrigado a declarar as duas coisas. O que nunca pode acontecer e o estado VERDE.
     */
    const snapshot: ExecutiveDashboardSnapshot = {
      ...EXECUTIVE_DASHBOARD_SNAPSHOT,
      attention: EXECUTIVE_DASHBOARD_SNAPSHOT.attention.filter(
        (item) => item.id === 'pending-measurements',
      ),
    };
    const scope = scopedAttention(snapshot, 'OPERACOES');
    const situation = buildOperationalSituation(snapshot, scope);

    expect(scope.notEvaluated).toEqual([
      'overdue-service-orders',
      'approaching-due-service-orders',
    ]);
    expect(situation.level).toBe('warning');
    // A ausencia NAO desaparece do texto so porque existe uma pendencia publicada.
    expect(situation.detail).toMatch(/não publicou avaliação/i);
    expect(situation.detail).toMatch(/ordens de serviço vencidas/i);
    // O estado verde e PROIBIDO quando falta publicacao.
    expect(situation.level).not.toBe('normal');
  });

  it('reports unknown when nothing was published but the recorte reaches sources', () => {
    // OPERACOES alcanca `pending-measurements`; o snapshot nao o publica e nao ha nenhum outro
    // fato no recorte. Sem fato publicado e sem cobertura completa, o estado e `unknown` — nunca
    // "sem excecoes criticas".
    const snapshot: ExecutiveDashboardSnapshot = {
      ...EXECUTIVE_DASHBOARD_SNAPSHOT,
      attention: [],
    };
    const scope = scopedAttention(snapshot, 'OPERACOES');
    const situation = buildOperationalSituation(snapshot, scope);

    expect(scope.notEvaluated.length).toBeGreaterThan(0);
    expect(situation.level).toBe('unknown');
    expect(situation.detail).toMatch(/desconhecido/i);
    expect(situation.level).not.toBe('normal');
    expect(situationBadgeLabel(situation)).toBe('Situação parcial');
  });

  it('reports normal only when every applicable source was published and came back empty', () => {
    const snapshot: ExecutiveDashboardSnapshot = { ...EXECUTIVE_DASHBOARD_SNAPSHOT, attention: [] };
    // Sem recorte: a base de avaliacao e o conjunto publicado pelo servidor.
    const situation = buildOperationalSituation(snapshot, scopedAttention(snapshot, null));

    expect(situation.level).toBe('normal');
    expect(situation.criticalCount).toBe(0);
    expect(situationBadgeLabel(situation)).toBe('Sem exceções críticas');
  });

  it('never repeats a chain-owned exception ("divergences") in the work queue', () => {
    const snapshot: ExecutiveDashboardSnapshot = {
      ...EXECUTIVE_DASHBOARD_SNAPSHOT,
      attention: [
        ...EXECUTIVE_DASHBOARD_SNAPSHOT.attention,
        {
          id: 'divergences',
          label: 'Divergências comerciais',
          count: 2,
          severity: 'critical',
          href: null,
          ariaLabel: 'Divergências comerciais: 2 itens',
          maxDelayDays: null,
          detail: 'Medições rejeitadas ou faturamento anulado',
        },
      ],
    };

    expect(scopedAttention(snapshot, null).items.map((item) => item.id)).not.toContain('divergences');
  });

  it('scopes exceptions to the selected domain instead of showing every domain at once', () => {
    const snapshot = EXECUTIVE_DASHBOARD_SNAPSHOT;

    expect(scopedAttention(snapshot, 'FINANCEIRO').items.map((item) => item.id)).toEqual([
      'overdue-receivables',
    ]);
    expect(scopedAttention(snapshot, 'OPERACOES').items.map((item) => item.id)).toEqual([
      'overdue-service-orders',
      'pending-measurements',
    ]);
    // Recorte sem fonte de excecao publicada: nada e exibido E nada e declarado normal.
    expect(scopedAttention(snapshot, 'FISCAL').notEvaluated).toEqual([]);
  });
});

describe('domain recorte reaches only the data it can reach', () => {
  it('declares which dimensions each domain can read', () => {
    // Sem recorte, o painel e agregado: alcanca tudo.
    expect(domainReachesOperation(null)).toBe(true);
    expect(domainReachesFinance(null)).toBe(true);

    expect(domainReachesOperation('OPERACOES')).toBe(true);
    expect(domainReachesOperation('FINANCEIRO')).toBe(false);
    expect(domainReachesFinance('FINANCEIRO')).toBe(true);
    expect(domainReachesFinance('OPERACOES')).toBe(false);

    // FISCAL/COMERCIAL/SUPRIMENTOS existem na FILA, mas nao no snapshot executivo.
    for (const domain of ['FISCAL', 'CONTABILIDADE', 'COMERCIAL', 'SUPRIMENTOS']) {
      expect(domainReachesOperation(domain)).toBe(false);
      expect(domainReachesFinance(domain)).toBe(false);
    }
  });

  it('drops operation indicators out of a recorte that cannot read operation', () => {
    const snapshot = EXECUTIVE_DASHBOARD_SNAPSHOT;
    const all = buildWorkbenchKpis(snapshot, null);
    const operations = buildWorkbenchKpis(snapshot, 'OPERACOES');
    const fiscal = buildWorkbenchKpis(snapshot, 'FISCAL');

    expect(all.some((kpi) => kpi.id === 'overdue-receivables')).toBe(true);
    expect(all.some((kpi) => kpi.id === 'overdue-service-orders')).toBe(true);

    // OPERACOES perde a carteira; FISCAL perde as duas dimensoes.
    expect(operations.some((kpi) => kpi.id === 'overdue-receivables')).toBe(false);
    expect(operations.some((kpi) => kpi.id === 'overdue-service-orders')).toBe(true);
    expect(fiscal).toHaveLength(0);
  });

  it('gives every workspace indicator a drill destination — no number without a list', () => {
    const kpis = buildWorkbenchKpis(EXECUTIVE_DASHBOARD_SNAPSHOT, null);
    expect(kpis.length).toBeGreaterThan(0);
    for (const kpi of kpis) {
      expect(kpi.href.length).toBeGreaterThan(0);
      expect(kpi.ariaLabel).toContain('Abrir');
    }
  });

  it('never emits an indicator whose count was not published', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    const kpis = buildWorkbenchKpis(snapshot, null);
    // O indicador ausente simplesmente NAO existe — nao vira card com zero.
    expect(kpis.some((kpi) => kpi.id === 'approaching-due-service-orders')).toBe(false);
  });
});

describe('business chain', () => {
  it('keeps a stage in the chain with an explicit unknown count instead of a zero', () => {
    const stages = buildBusinessFlow(EXECUTIVE_DASHBOARD_SNAPSHOT, null);
    const billing = stages.find((stage) => stage.id === 'billing');

    expect(billing).toBeDefined();
    expect(billing?.count).toBeNull();
    expect(billing?.situationLabel).toMatch(/sem contagem publicada/i);
  });

  it('does not affirm the operation stage inside a recorte that does not reach it', () => {
    const snapshot = EXECUTIVE_DASHBOARD_SNAPSHOT;

    expect(buildBusinessFlow(snapshot, 'COMERCIAL').map((stage) => stage.id)).not.toContain('operation');
    expect(buildBusinessFlow(snapshot, 'OPERACOES').map((stage) => stage.id)).toContain('operation');

    // A cadeia continua com as etapas que o recorte ALCANCA.
    expect(buildBusinessFlow(snapshot, 'FINANCEIRO').map((stage) => stage.id)).toEqual([
      'operation',
      'billing',
      'receivement',
    ]);
  });

  it('declares receivement without a count when the server did not publish the exception', () => {
    const snapshot = withoutAttention('overdue-receivables');
    const receivement = buildBusinessFlow(snapshot, null).find((stage) => stage.id === 'receivement');

    expect(receivement?.count).toBeNull();
    expect(receivement?.situationLabel).toMatch(/sem contagem publicada/i);
  });
});
