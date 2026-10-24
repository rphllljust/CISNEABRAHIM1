import { describe, expect, it } from 'vitest';
import {
  COMPLETION_BLOCK_REASONS,
  COMPLETION_CONSEQUENCES,
  COMPLETION_RESOLUTION_CODES,
  describeCompletionReason,
  describeCompletionResolution,
  evaluateCompletionGate,
  type CompletionFacts,
} from './completion-gate';
import { SERVICE_ORDER_STATUSES } from './service-order';

/**
 * COMPLETION GATE — a conclusão é um comando com requisitos, não um status.
 *
 * Cada teste desmonta UM requisito e prova que a conclusão fica bloqueada com o
 * motivo e a saída correspondentes.
 */

/** Base: execução em andamento com todos os requisitos atendidos. */
function baseFacts(overrides: Partial<CompletionFacts> = {}): CompletionFacts {
  return {
    serviceOrderId: 'so-1',
    status: SERVICE_ORDER_STATUSES.InExecution,
    requirements: {
      requiresFinalOdometer: true,
      requiresFinalHourMeter: false,
      requiresFuel: true,
      requiresLaborHours: true,
      requiresEquipmentHours: false,
      requiresMaterial: false,
      requiresCustomerSignature: true,
      requiresMeasuredQuantity: true,
    },
    evidence: [
      { evidenceKind: 'PHOTO', requirementLevel: 'REQUIRED', attached: true, verified: true },
    ],
    actuals: {
      finalOdometerRecorded: true,
      finalHourMeterRecorded: false,
      fuelRecorded: true,
      laborHoursByMember: [{ workforceMemberId: 'wm-1', hours: '9.2' }],
      equipmentHoursRecorded: false,
      materialRecorded: false,
      measuredQuantityRecorded: true,
    },
    signature: { registered: true, signerName: 'João', signedAt: '2026-10-24T14:00:00.000Z' },
    situations: [],
    assignedWorkforceMemberIds: ['wm-1'],
    resources: {
      vehicles: [{ id: 'al-1', code: 'VEH-027', kind: 'PHYSICAL_ASSET', label: 'Cavalo 027' }],
      equipment: [],
    },
    ...overrides,
  };
}

describe('evaluateCompletionGate — caminho feliz', () => {
  it('com todos os requisitos atendidos, a conclusão é permitida', () => {
    const gate = evaluateCompletionGate(baseFacts());
    expect(gate.canComplete).toBe(true);
    expect(gate.blockingReasons).toHaveLength(0);
    expect(gate.nextAction).toBeNull();
  });

  it('as consequências da conclusão são declaradas ANTES do clique', () => {
    const gate = evaluateCompletionGate(baseFacts());
    expect(gate.consequences).toEqual([...COMPLETION_CONSEQUENCES]);
    expect(gate.consequences.map((item) => item.code)).toContain('ACTUALS_FROZEN');
    expect(gate.consequences.map((item) => item.code)).toContain('MEASUREMENT_BASIS_CREATED');
  });

  it('o resumo diz que está pronto, não deixa vazio', () => {
    const gate = evaluateCompletionGate(baseFacts());
    expect(gate.summary).toContain('Pronto para concluir');
  });

  it('a saída é determinística', () => {
    expect(JSON.stringify(evaluateCompletionGate(baseFacts()))).toBe(
      JSON.stringify(evaluateCompletionGate(baseFacts())),
    );
  });
});

describe('estado da execução', () => {
  it('execução não iniciada não pode ser concluída', () => {
    const gate = evaluateCompletionGate(baseFacts({ status: SERVICE_ORDER_STATUSES.Released }));
    expect(gate.canComplete).toBe(false);
    expect(gate.blockingReasons[0]?.reasonCode).toBe(
      COMPLETION_BLOCK_REASONS.EXECUTION_NOT_STARTED,
    );
    expect(gate.nextAction).toBe(COMPLETION_RESOLUTION_CODES.START_EXECUTION);
  });

  it('ordem cancelada não pode ser concluída', () => {
    const gate = evaluateCompletionGate(baseFacts({ status: SERVICE_ORDER_STATUSES.Cancelled }));
    expect(gate.blockingReasons[0]?.reasonCode).toBe(COMPLETION_BLOCK_REASONS.EXECUTION_CANCELLED);
  });

  it('segunda conclusão é conflito explícito, não sucesso silencioso', () => {
    const gate = evaluateCompletionGate(baseFacts({ status: SERVICE_ORDER_STATUSES.Completed }));
    expect(gate.canComplete).toBe(false);
    expect(gate.blockingReasons[0]?.reasonCode).toBe(
      COMPLETION_BLOCK_REASONS.EXECUTION_ALREADY_COMPLETED,
    );
  });

  it('concluir PAUSADA esconderia tempo não medido: exige retomar', () => {
    const gate = evaluateCompletionGate(baseFacts({ status: SERVICE_ORDER_STATUSES.Paused }));
    expect(gate.canComplete).toBe(false);
    expect(gate.blockingReasons[0]?.reasonCode).toBe(COMPLETION_BLOCK_REASONS.NOT_IN_EXECUTION);
    expect(gate.nextAction).toBe(COMPLETION_RESOLUTION_CODES.RESUME_EXECUTION);
  });
});

describe('medidor final', () => {
  it('odômetro final ausente bloqueia com o motivo e a saída corretos', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        actuals: { ...baseFacts().actuals, finalOdometerRecorded: false },
      }),
    );
    expect(gate.canComplete).toBe(false);
    const odometer = gate.blockingReasons.find(
      (item) => item.reasonCode === COMPLETION_BLOCK_REASONS.FINAL_ODOMETER_REQUIRED,
    );
    expect(odometer).toBeDefined();
    expect(odometer?.missingCode).toBe('ODOMETER');
    expect(odometer?.resolution).toBe(COMPLETION_RESOLUTION_CODES.REGISTER_FINAL_METER);
    // O recurso culpado é nomeado — a tela não precisa descobrir.
    expect(odometer?.resource?.code).toBe('VEH-027');
  });

  it('horímetro final ausente bloqueia quando o serviço exige', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        requirements: { ...baseFacts().requirements, requiresFinalHourMeter: true },
      }),
    );
    expect(gate.blockingReasons.map((item) => item.reasonCode)).toContain(
      COMPLETION_BLOCK_REASONS.FINAL_HOUR_METER_REQUIRED,
    );
  });

  it('serviço que não exige medidor final não é bloqueado por ele', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        requirements: {
          ...baseFacts().requirements,
          requiresFinalOdometer: false,
          requiresFuel: false,
          requiresLaborHours: false,
          requiresCustomerSignature: false,
          requiresMeasuredQuantity: false,
        },
        actuals: {
          ...baseFacts().actuals,
          finalOdometerRecorded: false,
          fuelRecorded: false,
          laborHoursByMember: [],
          measuredQuantityRecorded: false,
        },
        signature: { registered: false, signerName: null, signedAt: null },
      }),
    );
    expect(gate.canComplete).toBe(true);
  });
});

describe('combustível, mão de obra, equipamento e material', () => {
  it('combustível real ausente bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({ actuals: { ...baseFacts().actuals, fuelRecorded: false } }),
    );
    const fuel = gate.blockingReasons.find(
      (item) => item.reasonCode === COMPLETION_BLOCK_REASONS.FUEL_ACTUAL_REQUIRED,
    );
    expect(fuel?.resolution).toBe(COMPLETION_RESOLUTION_CODES.REGISTER_FUEL);
  });

  it('horas de mão de obra faltando para UMA pessoa bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        assignedWorkforceMemberIds: ['wm-1', 'wm-2'],
        actuals: {
          ...baseFacts().actuals,
          laborHoursByMember: [
            { workforceMemberId: 'wm-1', hours: '9.2' },
            { workforceMemberId: 'wm-2', hours: null },
          ],
        },
      }),
    );
    const labor = gate.blockingReasons.find(
      (item) => item.reasonCode === COMPLETION_BLOCK_REASONS.LABOR_ACTUAL_REQUIRED,
    );
    expect(labor).toBeDefined();
    expect(labor?.resolution).toBe(COMPLETION_RESOLUTION_CODES.REGISTER_LABOR_HOURS);
  });

  it('horas ZERO não contam como registradas', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        actuals: {
          ...baseFacts().actuals,
          laborHoursByMember: [{ workforceMemberId: 'wm-1', hours: '0' }],
        },
      }),
    );
    expect(gate.canComplete).toBe(false);
  });

  it('equipamento exigido sem horas bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        requirements: { ...baseFacts().requirements, requiresEquipmentHours: true },
      }),
    );
    expect(gate.blockingReasons.map((item) => item.reasonCode)).toContain(
      COMPLETION_BLOCK_REASONS.EQUIPMENT_ACTUAL_REQUIRED,
    );
  });

  it('material exigido sem realização bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({ requirements: { ...baseFacts().requirements, requiresMaterial: true } }),
    );
    expect(gate.blockingReasons.map((item) => item.reasonCode)).toContain(
      COMPLETION_BLOCK_REASONS.MATERIAL_ACTUAL_REQUIRED,
    );
  });

  it('quantidade medida obrigatória e ausente bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({ actuals: { ...baseFacts().actuals, measuredQuantityRecorded: false } }),
    );
    expect(gate.blockingReasons.map((item) => item.reasonCode)).toContain(
      COMPLETION_BLOCK_REASONS.EXECUTION_REQUIREMENT_UNMET,
    );
  });
});

describe('evidência', () => {
  it('evidência obrigatória ausente bloqueia com ATTACH_EVIDENCE', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        evidence: [
          { evidenceKind: 'PHOTO', requirementLevel: 'REQUIRED', attached: false, verified: false },
        ],
      }),
    );
    const evidence = gate.blockingReasons.find(
      (item) => item.reasonCode === COMPLETION_BLOCK_REASONS.REQUIRED_EVIDENCE_MISSING,
    );
    expect(evidence?.missingCode).toBe('PHOTO');
    expect(evidence?.resolution).toBe(COMPLETION_RESOLUTION_CODES.ATTACH_EVIDENCE);
  });

  it('evidência ANEXADA mas não verificada bloqueia com VERIFY_EVIDENCE', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        evidence: [
          { evidenceKind: 'PHOTO', requirementLevel: 'REQUIRED', attached: true, verified: false },
        ],
      }),
    );
    const evidence = gate.blockingReasons.find(
      (item) => item.reasonCode === COMPLETION_BLOCK_REASONS.EVIDENCE_NOT_VERIFIED,
    );
    expect(evidence?.resolution).toBe(COMPLETION_RESOLUTION_CODES.VERIFY_EVIDENCE);
  });

  it('evidência OPCIONAL ausente não bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        evidence: [
          { evidenceKind: 'PHOTO', requirementLevel: 'OPTIONAL', attached: false, verified: false },
        ],
      }),
    );
    expect(gate.canComplete).toBe(true);
  });
});

describe('assinatura do cliente', () => {
  it('assinatura exigida e ausente bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({ signature: { registered: false, signerName: null, signedAt: null } }),
    );
    const signature = gate.blockingReasons.find(
      (item) => item.reasonCode === COMPLETION_BLOCK_REASONS.CUSTOMER_SIGNATURE_REQUIRED,
    );
    expect(signature?.resolution).toBe(COMPLETION_RESOLUTION_CODES.REGISTER_SIGNATURE);
  });

  it('assinatura não exigida pelo contrato não bloqueia', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        requirements: { ...baseFacts().requirements, requiresCustomerSignature: false },
        signature: { registered: false, signerName: null, signedAt: null },
      }),
    );
    expect(gate.canComplete).toBe(true);
  });
});

describe('situações abertas', () => {
  it('situação bloqueante impede a conclusão', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        situations: [{ code: 'METER_ANOMALY', title: 'Leitura incoerente', blocking: true }],
      }),
    );
    const situation = gate.blockingReasons.find(
      (item) => item.reasonCode === COMPLETION_BLOCK_REASONS.BLOCKING_SITUATION_OPEN,
    );
    expect(situation?.missingCode).toBe('METER_ANOMALY');
    expect(situation?.resolution).toBe(COMPLETION_RESOLUTION_CODES.RESOLVE_SITUATION);
  });

  it('situação não bloqueante não impede', () => {
    const gate = evaluateCompletionGate(
      baseFacts({ situations: [{ code: 'INFO', title: 'Aviso', blocking: false }] }),
    );
    expect(gate.canComplete).toBe(true);
  });
});

describe('agregação de motivos', () => {
  it('TODOS os motivos são devolvidos, nunca só o primeiro', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        actuals: {
          ...baseFacts().actuals,
          finalOdometerRecorded: false,
          fuelRecorded: false,
        },
        signature: { registered: false, signerName: null, signedAt: null },
        evidence: [
          {
            evidenceKind: 'SIGNATURE',
            requirementLevel: 'REQUIRED',
            attached: false,
            verified: false,
          },
        ],
      }),
    );
    const codes = gate.blockingReasons.map((item) => item.reasonCode);
    expect(codes).toContain(COMPLETION_BLOCK_REASONS.FINAL_ODOMETER_REQUIRED);
    expect(codes).toContain(COMPLETION_BLOCK_REASONS.FUEL_ACTUAL_REQUIRED);
    expect(codes).toContain(COMPLETION_BLOCK_REASONS.CUSTOMER_SIGNATURE_REQUIRED);
    expect(codes).toContain(COMPLETION_BLOCK_REASONS.REQUIRED_EVIDENCE_MISSING);
    expect(gate.blockingReasons.length).toBeGreaterThanOrEqual(4);
  });

  it('o primeiro motivo define a próxima ação', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        actuals: { ...baseFacts().actuals, finalOdometerRecorded: false, fuelRecorded: false },
      }),
    );
    expect(gate.nextAction).toBe(gate.blockingReasons[0]?.resolution);
  });

  it('cada motivo tem rótulo legível — nenhum código cru', () => {
    const gate = evaluateCompletionGate(
      baseFacts({
        actuals: { ...baseFacts().actuals, finalOdometerRecorded: false },
        signature: { registered: false, signerName: null, signedAt: null },
      }),
    );
    for (const item of gate.blockingReasons) {
      expect(item.reason.length).toBeGreaterThan(10);
      expect(item.reason).not.toBe(item.reasonCode);
      expect(item.resolutionLabel.length).toBeGreaterThan(3);
    }
  });

  it('não muta os fatos recebidos', () => {
    const facts = baseFacts();
    const snapshot = JSON.stringify(facts);
    evaluateCompletionGate(facts);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});

describe('rótulos', () => {
  it('todo motivo tem texto humano', () => {
    for (const code of Object.values(COMPLETION_BLOCK_REASONS)) {
      expect(describeCompletionReason(code)).not.toBe(code);
    }
  });

  it('toda resolução tem texto humano', () => {
    for (const code of Object.values(COMPLETION_RESOLUTION_CODES)) {
      expect(describeCompletionResolution(code)).not.toBe(code);
    }
  });
});
