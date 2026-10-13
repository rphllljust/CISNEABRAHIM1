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

  /*
   * ESTRUTURA ESTAVEL — a faixa publica as MESMAS celulas em todo recorte.
   *
   * A regra anterior era "indicador que o recorte nao alcanca nao entra na faixa", e por isso a
   * faixa encolhia de cinco celulas para tres (ou zero) conforme o chip, fazendo o cockpit parecer
   * quebrado e escondendo do operador QUAIS indicadores existem. A regra agora e outra, e continua
   * honesta:
   *
   *   metrica fora do dominio do recorte -> celula presente, valor `—`, `unmeasured: true`;
   *   metrica no dominio mas nao publicada -> celula presente, valor `—`, `unmeasured: true`.
   *
   * Nenhum numero de OPERACAO aparece sob um recorte COMERCIAL: o que muda e o ESTADO da celula,
   * nunca o dado. AUSENCIA != ZERO, e ausencia tambem nao desmonta a faixa.
   */
  it('keeps the KPI band structurally identical across recortes, with honest states', () => {
    const snapshot = EXECUTIVE_DASHBOARD_SNAPSHOT;
    const all = buildWorkbenchKpis(snapshot, null);
    const operations = buildWorkbenchKpis(snapshot, 'OPERACOES');
    const fiscal = buildWorkbenchKpis(snapshot, 'FISCAL');

    const ids = (list: typeof all) => list.map((kpi) => kpi.id);
    expect(ids(operations)).toEqual(ids(all));
    expect(ids(fiscal)).toEqual(ids(all));

    // OPERACOES: a carteira sai do ESCOPO — celula presente, sem valor, sem numero emprestado.
    const receivables = operations.find((kpi) => kpi.id === 'overdue-receivables');
    expect(receivables?.value).toBe('—');
    expect(receivables?.unmeasured).toBe(true);
    expect(receivables?.context).toMatch(/fora do recorte/i);

    // FISCAL nao alcanca nenhuma das dimensoes: TODAS as celulas ficam nao medidas.
    expect(fiscal.every((kpi) => kpi.unmeasured)).toBe(true);
    expect(fiscal.every((kpi) => kpi.value === '—')).toBe(true);
    // E nenhuma delas afirma zero.
    expect(fiscal.some((kpi) => kpi.value === '0')).toBe(false);
  });

  it('gives every workspace indicator a drill destination — no number without a list', () => {
    const kpis = buildWorkbenchKpis(EXECUTIVE_DASHBOARD_SNAPSHOT, null);
    expect(kpis.length).toBeGreaterThan(0);
    for (const kpi of kpis) {
      // Toda celula tem destino: numero sem lista e decoracao, e celula sem valor tambem aponta
      // para a lista, porque e a LISTA que existe — o que falta e a contagem sob este recorte.
      expect(kpi.href.length).toBeGreaterThan(0);
      expect(kpi.ariaLabel.length).toBeGreaterThan(0);
    }
    // As celulas COM valor afirmam numericamente; as sem valor dizem "não publicado".
    for (const kpi of kpis.filter((candidate) => !candidate.unmeasured)) {
      expect(kpi.value).not.toBe('—');
    }
    for (const kpi of kpis.filter((candidate) => candidate.unmeasured)) {
      expect(kpi.value).toBe('—');
      expect(kpi.context).toMatch(/não publicado|fora do recorte/i);
    }
  });

  it('never turns an unpublished count into zero', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    const kpis = buildWorkbenchKpis(snapshot, null);
    const approaching = kpis.find((kpi) => kpi.id === 'approaching-due-service-orders');

    // O indicador CONTINUA na faixa — mas sem afirmar numero e sem afirmar zero.
    expect(approaching).toBeDefined();
    expect(approaching?.value).toBe('—');
    expect(approaching?.unmeasured).toBe(true);
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

  it('keeps the operation stage in the chain outside its own recorte, without a count', () => {
    const snapshot = EXECUTIVE_DASHBOARD_SNAPSHOT;

    /*
     * A TRILHA E O PROCESSO INTEIRO — nao apenas as etapas que o recorte alcanca.
     *
     * Antes, a etapa sumia quando o recorte nao a alimentava. Isso apagava do operador a FORMA do
     * processo que ele opera: a trilha do CISNE e Solicitacao -> Proposta -> Contrato -> Ordem de
     * servico -> Medicao -> Faturamento -> Recebimento, e essa forma nao depende de qual chip esta
     * ativo.
     *
     * O que o recorte governa e a CONTAGEM, nunca a existencia da etapa: fora do dominio que a
     * alimenta, a etapa permanece com `count: null` e `unmeasured: true` — nenhum numero de OPERACAO
     * aparece sob um recorte COMERCIAL.
     */
    const commercial = buildBusinessFlow(snapshot, 'COMERCIAL');
    expect(commercial.map((stage) => stage.id)).toEqual([
      'request',
      'proposal',
      'contract',
      'operation',
      'measurement',
      'billing',
      'receivement',
    ]);

    const operationOutOfScope = commercial.find((stage) => stage.id === 'operation');
    expect(operationOutOfScope?.count).toBeNull();
    expect(operationOutOfScope?.unmeasured).toBe(true);
    expect(operationOutOfScope?.situationLabel).toMatch(/fora do recorte/i);

    // Dentro do recorte que a alimenta, a etapa afirma a contagem publicada.
    const operations = buildBusinessFlow(snapshot, 'OPERACOES');
    const operationInScope = operations.find((stage) => stage.id === 'operation');
    expect(operationInScope?.count).not.toBeNull();
    expect(operationInScope?.unmeasured).toBe(false);
  });

  it('publishes the full process trail even when no stage has a published count', () => {
    const stages = buildBusinessFlow(EXECUTIVE_DASHBOARD_SNAPSHOT, null);

    // As sete etapas reais do processo, sempre, na ordem do negocio.
    expect(stages.map((stage) => stage.id)).toEqual([
      'request',
      'proposal',
      'contract',
      'operation',
      'measurement',
      'billing',
      'receivement',
    ]);

    // Etapa sem contador continua na trilha, marcada como nao medida — e nunca como zero.
    for (const stage of stages.filter((candidate) => candidate.count === null)) {
      expect(stage.unmeasured).toBe(true);
      expect(stage.situationLabel).toMatch(/sem contagem publicada|fora do recorte/i);
    }
  });

  it('declares receivement without a count when the server did not publish the exception', () => {
    const snapshot = withoutAttention('overdue-receivables');
    const receivement = buildBusinessFlow(snapshot, null).find((stage) => stage.id === 'receivement');

    expect(receivement?.count).toBeNull();
    expect(receivement?.situationLabel).toMatch(/sem contagem publicada/i);
  });
});
