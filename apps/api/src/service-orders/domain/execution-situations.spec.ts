import { describe, expect, it } from 'vitest';
import {
  EXECUTION_SITUATION_CODES,
  SITUATION_THRESHOLDS,
  detectExecutionSituations,
  formatSlaRemaining,
  type ExecutionSituationFacts,
} from './execution-situations';

/**
 * SITUATION ENGINE — a exceção é DETECTADA, não esperada.
 *
 * Todo teste usa um instante fixo (`AT`). Ler o relógio dentro da detecção
 * tornaria impossível provar "pausada há 2h" — e um detector que não pode ser
 * provado é um detector que ninguém confia.
 */

const AT = '2026-10-24T15:00:00.000Z';

function baseFacts(overrides: Partial<ExecutionSituationFacts> = {}): ExecutionSituationFacts {
  return {
    serviceOrderId: 'so-1',
    unitId: 'UN-1',
    orderNumber: 'OS-842',
    clientLabel: 'AMAGGI',
    status: 'IN_EXECUTION',
    dispatchedAt: '2026-10-24T08:00:00.000Z',
    checkedInAt: '2026-10-24T08:10:00.000Z',
    startedAt: '2026-10-24T08:14:00.000Z',
    pausedAt: null,
    completedAt: null,
    slaDueAt: '2026-10-24T18:00:00.000Z',
    windowEndAt: '2026-10-24T18:00:00.000Z',
    plannedQuantity: '100',
    measuredQuantity: '80',
    dispatchBlockedReasons: [],
    requiredActualsMissing: [],
    requiredEvidenceMissing: [],
    evidenceNotVerified: [],
    meterAnomalyCode: null,
    fuelActualLiters: null,
    fuelPlannedLiters: null,
    unplannedResourceCodes: [],
    changedResourceCodes: [],
    completionBlockedReasons: [],
    financialExposure: '82400',
    persisted: [],
    ...overrides,
  };
}

function codes(facts: ExecutionSituationFacts): string[] {
  return detectExecutionSituations(facts, AT).situations.map((item) => item.code);
}

describe('execução saudável', () => {
  it('ordem em dia não produz exceção', () => {
    const result = detectExecutionSituations(baseFacts(), AT);
    expect(result.situations).toHaveLength(0);
    expect(result.hasBlocking).toBe(false);
  });

  it('sem execução, não há exceção de SLA nem de realizado', () => {
    const result = detectExecutionSituations(
      baseFacts({
        status: 'RELEASED',
        startedAt: null,
        dispatchedAt: null,
        slaDueAt: '2026-10-01T00:00:00.000Z',
      }),
      AT,
    );
    expect(result.situations).toHaveLength(0);
  });
});

describe('DISPATCH_BLOCKED', () => {
  it('despacho bloqueado vira situação bloqueante com dono e ação', () => {
    const result = detectExecutionSituations(
      baseFacts({
        status: 'RELEASED',
        startedAt: null,
        dispatchedAt: null,
        dispatchBlockedReasons: ['QUALIFICATION_EXPIRED', 'VEHICLE_UNAVAILABLE'],
      }),
      AT,
    );
    const situation = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.DISPATCH_BLOCKED,
    );
    expect(situation).toBeDefined();
    expect(situation?.blocking).toBe(true);
    expect(situation?.severity).toBe('P2');
    expect(situation?.ownerRole).toBe('CENTRAL_CONTROLE');
    expect(situation?.nextBestAction).toBe('RESOLVE_DISPATCH_BLOCK');
    expect(result.hasBlocking).toBe(true);
  });

  it('a chave lógica ordena os motivos: mesma falha, mesma chave', () => {
    const first = detectExecutionSituations(
      baseFacts({
        status: 'RELEASED',
        startedAt: null,
        dispatchedAt: null,
        dispatchBlockedReasons: ['A_BLOCK', 'B_BLOCK'],
      }),
      AT,
    );
    const second = detectExecutionSituations(
      baseFacts({
        status: 'RELEASED',
        startedAt: null,
        dispatchedAt: null,
        dispatchBlockedReasons: ['B_BLOCK', 'A_BLOCK'],
      }),
      AT,
    );
    expect(first.situations[0]?.detectedKey).toBe(second.situations[0]?.detectedKey);
  });
});

describe('EXECUTION_NOT_STARTED', () => {
  it('despachada há mais que a tolerância sem iniciar gera situação', () => {
    const dispatchedAt = new Date(
      new Date(AT).getTime() - (SITUATION_THRESHOLDS.NOT_STARTED_TOLERANCE_MINUTES + 5) * 60_000,
    ).toISOString();
    const result = detectExecutionSituations(baseFacts({ startedAt: null, dispatchedAt }), AT);
    expect(result.situations.map((item) => item.code)).toContain(
      EXECUTION_SITUATION_CODES.EXECUTION_NOT_STARTED,
    );
  });

  it('dentro da tolerância não gera situação', () => {
    const dispatchedAt = new Date(
      new Date(AT).getTime() - (SITUATION_THRESHOLDS.NOT_STARTED_TOLERANCE_MINUTES - 5) * 60_000,
    ).toISOString();
    const result = detectExecutionSituations(baseFacts({ startedAt: null, dispatchedAt }), AT);
    expect(result.situations).toHaveLength(0);
  });

  it('dobro da tolerância eleva a severidade para P1', () => {
    const dispatchedAt = new Date(
      new Date(AT).getTime() - SITUATION_THRESHOLDS.NOT_STARTED_TOLERANCE_MINUTES * 2.5 * 60_000,
    ).toISOString();
    const result = detectExecutionSituations(baseFacts({ startedAt: null, dispatchedAt }), AT);
    expect(result.situations[0]?.severity).toBe('P1');
  });
});

describe('EXECUTION_OVERDUE', () => {
  it('prazo vencido gera situação P1 com escalonamento', () => {
    const result = detectExecutionSituations(
      baseFacts({ slaDueAt: '2026-10-24T14:00:00.000Z' }),
      AT,
    );
    const overdue = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.EXECUTION_OVERDUE,
    );
    expect(overdue?.severity).toBe('P1');
    expect(overdue?.nextBestAction).toBe('ESCALATE');
    expect(overdue?.ownerRole).toBe('SUPERVISOR_OPERACOES');
    expect(overdue?.detail).toContain('1h00');
  });
});

describe('EXECUTION_SLA_AT_RISK', () => {
  it('execução atrás do ritmo gera situação com progresso e ritmo', () => {
    /**
     * Janela: 08:14 → 18:00 (586 min). Agora 15:00 → 406 min decorridos (69%).
     * Medido 20 de 100 = 20%. Bem abaixo de 69% * 0.8 e abaixo do piso de 50%.
     */
    const result = detectExecutionSituations(baseFacts({ measuredQuantity: '20' }), AT);
    const atRisk = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.EXECUTION_SLA_AT_RISK,
    );
    expect(atRisk).toBeDefined();
    expect(atRisk?.detail).toContain('20%');
    expect(atRisk?.detail).toContain('69%');
    expect(atRisk?.nextBestAction).toBe('PRIORITIZE_EXECUTION');
  });

  it('execução no ritmo NÃO gera situação', () => {
    // 80 de 100 = 80%, acima do piso de 50% e acima de 69% * 0.8.
    const result = detectExecutionSituations(baseFacts({ measuredQuantity: '80' }), AT);
    expect(codes(baseFacts({ measuredQuantity: '80' }))).not.toContain(
      EXECUTION_SITUATION_CODES.EXECUTION_SLA_AT_RISK,
    );
    expect(result.situations).toHaveLength(0);
  });

  it('sem meta declarada, não há ritmo a julgar', () => {
    const result = detectExecutionSituations(
      baseFacts({ plannedQuantity: null, measuredQuantity: null }),
      AT,
    );
    expect(result.situations.map((item) => item.code)).not.toContain(
      EXECUTION_SITUATION_CODES.EXECUTION_SLA_AT_RISK,
    );
  });

  it('sem prazo publicado, não há risco de SLA', () => {
    const result = detectExecutionSituations(
      baseFacts({ slaDueAt: null, measuredQuantity: '10' }),
      AT,
    );
    expect(result.situations).toHaveLength(0);
  });
});

describe('EXECUTION_PAUSED_TOO_LONG', () => {
  it('pausa acima da tolerância gera situação', () => {
    const pausedAt = new Date(
      new Date(AT).getTime() - (SITUATION_THRESHOLDS.PAUSE_TOLERANCE_MINUTES + 30) * 60_000,
    ).toISOString();
    const result = detectExecutionSituations(baseFacts({ status: 'PAUSED', pausedAt }), AT);
    const paused = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.EXECUTION_PAUSED_TOO_LONG,
    );
    expect(paused).toBeDefined();
    expect(paused?.nextBestAction).toBe('RESUME_EXECUTION');
    expect(paused?.ownerRole).toBe('SUPERVISOR_CAMPO');
  });

  it('pausa curta não gera situação', () => {
    const pausedAt = new Date(
      new Date(AT).getTime() - (SITUATION_THRESHOLDS.PAUSE_TOLERANCE_MINUTES - 10) * 60_000,
    ).toISOString();
    const result = detectExecutionSituations(baseFacts({ status: 'PAUSED', pausedAt }), AT);
    expect(result.situations).toHaveLength(0);
  });
});

describe('RESOURCE_CHANGED e UNPLANNED_RESOURCE_USAGE', () => {
  it('recurso trocado gera situação por recurso (chave distinta por recurso)', () => {
    const result = detectExecutionSituations(
      baseFacts({ changedResourceCodes: ['VEH-031', 'DRV-044'] }),
      AT,
    );
    const changed = result.situations.filter(
      (item) => item.code === EXECUTION_SITUATION_CODES.RESOURCE_CHANGED,
    );
    expect(changed).toHaveLength(2);
    expect(changed.map((item) => item.detectedKey)).toEqual(['changed:DRV-044', 'changed:VEH-031']);
    expect(changed[0]?.nextBestAction).toBe('JUSTIFY_RESOURCE_CHANGE');
  });

  it('uso de recurso não planejado gera situação de revisão', () => {
    const result = detectExecutionSituations(baseFacts({ unplannedResourceCodes: ['EQP-9'] }), AT);
    expect(result.situations.map((item) => item.code)).toContain(
      EXECUTION_SITUATION_CODES.UNPLANNED_RESOURCE_USAGE,
    );
  });
});

describe('MISSING_ACTUALS e MISSING_EVIDENCE', () => {
  it('realizado faltando gera situação bloqueante', () => {
    const result = detectExecutionSituations(
      baseFacts({ requiredActualsMissing: ['FUEL_VOLUME', 'LABOR_HOURS'] }),
      AT,
    );
    const missing = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.MISSING_ACTUALS,
    );
    expect(missing?.blocking).toBe(true);
    expect(missing?.nextBestAction).toBe('REGISTER_MISSING_ACTUALS');
    expect(result.hasBlocking).toBe(true);
  });

  it('evidência faltando gera situação bloqueante', () => {
    const result = detectExecutionSituations(baseFacts({ requiredEvidenceMissing: ['PHOTO'] }), AT);
    expect(result.situations.map((item) => item.code)).toContain(
      EXECUTION_SITUATION_CODES.MISSING_EVIDENCE,
    );
    expect(result.hasBlocking).toBe(true);
  });

  it('evidência anexada não verificada gera aviso, NÃO bloqueio', () => {
    const result = detectExecutionSituations(baseFacts({ evidenceNotVerified: ['SIGNATURE'] }), AT);
    const pending = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.MISSING_EVIDENCE,
    );
    expect(pending).toBeDefined();
    expect(pending?.blocking).toBe(false);
    expect(pending?.detectedKey).toBe('verify:SIGNATURE');
  });

  it('ordem já concluída não acusa realizado faltando', () => {
    const result = detectExecutionSituations(
      baseFacts({
        completedAt: '2026-10-24T14:00:00.000Z',
        requiredActualsMissing: ['FUEL_VOLUME'],
      }),
      AT,
    );
    expect(result.situations.map((item) => item.code)).not.toContain(
      EXECUTION_SITUATION_CODES.MISSING_ACTUALS,
    );
  });
});

describe('METER_ANOMALY e FUEL_VARIANCE', () => {
  it('anomalia de medidor é bloqueante', () => {
    const result = detectExecutionSituations(
      baseFacts({ meterAnomalyCode: 'METER_READING_NOT_MONOTONIC' }),
      AT,
    );
    const anomaly = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.METER_ANOMALY,
    );
    expect(anomaly?.blocking).toBe(true);
    expect(anomaly?.nextBestAction).toBe('REVIEW_METER');
  });

  it('desvio de combustível acima da tolerância gera situação', () => {
    const result = detectExecutionSituations(
      baseFacts({ fuelActualLiters: '180', fuelPlannedLiters: '130' }),
      AT,
    );
    const fuel = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.FUEL_VARIANCE,
    );
    expect(fuel).toBeDefined();
    expect(fuel?.detail).toContain('+38%');
  });

  it('desvio dentro da tolerância não gera situação', () => {
    const result = detectExecutionSituations(
      baseFacts({ fuelActualLiters: '140', fuelPlannedLiters: '130' }),
      AT,
    );
    expect(result.situations).toHaveLength(0);
  });

  it('sem planejado de combustível não há desvio a julgar', () => {
    const result = detectExecutionSituations(
      baseFacts({ fuelActualLiters: '180', fuelPlannedLiters: null }),
      AT,
    );
    expect(result.situations).toHaveLength(0);
  });
});

describe('EXECUTION_COMPLETION_BLOCKED', () => {
  it('conclusão bloqueada gera situação bloqueante', () => {
    const result = detectExecutionSituations(
      baseFacts({ completionBlockedReasons: ['FINAL_ODOMETER_REQUIRED'] }),
      AT,
    );
    const blocked = result.situations.find(
      (item) => item.code === EXECUTION_SITUATION_CODES.EXECUTION_COMPLETION_BLOCKED,
    );
    expect(blocked?.blocking).toBe(true);
    expect(blocked?.nextBestAction).toBe('REGISTER_MISSING_ACTUALS');
  });
});

describe('deduplicação e resolução', () => {
  it('situação já aberta é reconhecida como já registrada', () => {
    const result = detectExecutionSituations(
      baseFacts({
        requiredActualsMissing: ['FUEL_VOLUME'],
        persisted: [
          {
            id: 'sit-1',
            code: EXECUTION_SITUATION_CODES.MISSING_ACTUALS,
            detectedKey: 'FUEL_VOLUME',
            status: 'OPEN',
          },
        ],
      }),
      AT,
    );
    expect(result.situations[0]?.alreadyOpen).toBe(true);
    expect(result.newSituations).toHaveLength(0);
  });

  it('situação aberta que deixou de ser detectada é marcada para resolução', () => {
    const result = detectExecutionSituations(
      baseFacts({
        requiredActualsMissing: [],
        persisted: [
          {
            id: 'sit-1',
            code: EXECUTION_SITUATION_CODES.MISSING_ACTUALS,
            detectedKey: 'FUEL_VOLUME',
            status: 'OPEN',
          },
        ],
      }),
      AT,
    );
    expect(result.resolvableSituationIds).toEqual(['sit-1']);
  });

  it('situação já resolvida não é reaberta automaticamente', () => {
    const result = detectExecutionSituations(
      baseFacts({
        requiredActualsMissing: ['FUEL_VOLUME'],
        persisted: [
          {
            id: 'sit-1',
            code: EXECUTION_SITUATION_CODES.MISSING_ACTUALS,
            detectedKey: 'FUEL_VOLUME',
            status: 'RESOLVED',
          },
        ],
      }),
      AT,
    );
    const situation = result.situations[0];
    expect(situation?.alreadyOpen).toBe(false);
    expect(result.newSituations).toHaveLength(1);
  });
});

describe('ordenação', () => {
  it('P1 vem antes de P2, que vem antes de P3', () => {
    const result = detectExecutionSituations(
      baseFacts({
        slaDueAt: '2026-10-24T14:00:00.000Z', // P1 overdue
        changedResourceCodes: ['VEH-1'], // P3
        requiredActualsMissing: ['FUEL'], // P2
      }),
      AT,
    );
    const severities = result.situations.map((item) => item.severity);
    expect(severities[0]).toBe('P1');
    const p1LastIndex = severities.lastIndexOf('P1');
    const p3FirstIndex = severities.indexOf('P3');
    if (p1LastIndex >= 0 && p3FirstIndex >= 0) {
      expect(p1LastIndex).toBeLessThan(p3FirstIndex);
    }
  });

  it('a ordenação é estável entre chamadas', () => {
    const facts = baseFacts({
      slaDueAt: '2026-10-24T14:00:00.000Z',
      changedResourceCodes: ['VEH-1', 'VEH-2'],
    });
    const first = detectExecutionSituations(facts, AT).situations.map((s) => s.detectedKey);
    const second = detectExecutionSituations(facts, AT).situations.map((s) => s.detectedKey);
    expect(first).toEqual(second);
  });
});

describe('contrato de saída', () => {
  it('toda situação traz dono, ação e impacto — nada fica em aberto', () => {
    const result = detectExecutionSituations(
      baseFacts({
        slaDueAt: '2026-10-24T14:00:00.000Z',
        requiredActualsMissing: ['FUEL'],
        changedResourceCodes: ['VEH-1'],
        meterAnomalyCode: 'METER_READING_NOT_MONOTONIC',
      }),
      AT,
    );
    for (const situation of result.situations) {
      expect(situation.ownerRole).toBeTruthy();
      expect(situation.nextBestAction).toBeTruthy();
      expect(situation.title.length).toBeGreaterThan(5);
      expect(situation.detail.length).toBeGreaterThan(5);
      expect(situation.impact.length).toBeGreaterThan(5);
      expect(situation.detectedKey.length).toBeGreaterThan(0);
    }
  });

  it('a exposição financeira é propagada quando o domínio a conhece', () => {
    const result = detectExecutionSituations(
      baseFacts({ slaDueAt: '2026-10-24T14:00:00.000Z' }),
      AT,
    );
    expect(result.situations[0]?.financialExposure).toBe('82400');
  });

  it('não muta os fatos recebidos', () => {
    const facts = baseFacts({ changedResourceCodes: ['VEH-1'] });
    const snapshot = JSON.stringify(facts);
    detectExecutionSituations(facts, AT);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});

describe('formatSlaRemaining', () => {
  it('formata tempo restante positivo', () => {
    expect(formatSlaRemaining(192)).toBe('3h12');
  });

  it('formata tempo vencido com sinal negativo', () => {
    expect(formatSlaRemaining(-18)).toBe('-0h18');
  });

  it('formata zero', () => {
    expect(formatSlaRemaining(0)).toBe('0h00');
  });
});
