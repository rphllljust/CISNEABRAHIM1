import { describe, expect, it } from 'vitest';
import {
  DISPATCH_BLOCK_REASONS,
  DISPATCH_READINESS_DIMENSIONS,
  DISPATCH_RESOLUTION_CODES,
  isDispatchableStatus,
  describeDispatchReason,
  describeDispatchResolution,
  evaluateDispatchReadiness,
  type DispatchFacts,
} from './dispatch-readiness';
import { SERVICE_ORDER_STATUSES } from './service-order';

/**
 * READINESS DE DESPACHO — a autoridade de "esta ordem pode sair?".
 *
 * Estes testes fixam o CONTRATO da decisão, não a implementação: cada dimensão
 * tem de responder sozinha, e o agregado tem de ser explicável.
 */

const AT = '2026-10-24T12:00:00.000Z';

/** Base: tudo pronto. Cada teste desmonta UMA coisa e prova que ela bloqueia. */
function baseFacts(overrides: Partial<DispatchFacts> = {}): DispatchFacts {
  return {
    serviceOrderId: 'so-1',
    status: SERVICE_ORDER_STATUSES.Released,
    requirements: [
      {
        requirementKind: 'PHYSICAL_RESOURCE',
        resourceTypeCode: 'VEICULO',
        laborTypeCode: null,
        requirementLevel: 'REQUIRED',
        minQuantity: '1',
      },
      {
        requirementKind: 'LABOR',
        resourceTypeCode: null,
        laborTypeCode: 'MOTORISTA',
        requirementLevel: 'REQUIRED',
        minQuantity: '1',
      },
    ],
    plannedResources: [
      {
        id: 'pr-1',
        requirementKind: 'PHYSICAL_RESOURCE',
        resourceTypeCode: 'VEICULO',
        laborTypeCode: null,
        plannedQuantity: '1',
        operationalStart: '2026-10-24T12:00:00.000Z',
        operationalEnd: '2026-10-24T20:00:00.000Z',
        status: 'PLANNED',
      },
      {
        id: 'pr-2',
        requirementKind: 'LABOR',
        resourceTypeCode: null,
        laborTypeCode: 'MOTORISTA',
        plannedQuantity: '1',
        operationalStart: '2026-10-24T12:00:00.000Z',
        operationalEnd: '2026-10-24T20:00:00.000Z',
        status: 'PLANNED',
      },
    ],
    allocations: [
      {
        id: 'al-1',
        resourceTypeCode: 'VEICULO',
        operationalStart: '2026-10-24T12:00:00.000Z',
        operationalEnd: '2026-10-24T20:00:00.000Z',
        status: 'ACTIVE',
        resourceKind: 'PHYSICAL_ASSET',
        resourceCode: 'VEH-027',
        resourceLabel: 'Cavalo 027',
        resourceActive: true,
        underMaintenance: false,
        requiresDriver: true,
        qualifications: [],
      },
      {
        id: 'al-2',
        resourceTypeCode: 'MOTORISTA',
        operationalStart: '2026-10-24T12:00:00.000Z',
        operationalEnd: '2026-10-24T20:00:00.000Z',
        status: 'ACTIVE',
        resourceKind: 'WORKFORCE_MEMBER',
        resourceCode: 'DRV-019',
        resourceLabel: 'Carlos',
        resourceActive: true,
        underMaintenance: false,
        requiresDriver: true,
        qualifications: [{ code: 'MOPP', expiresAt: '2027-01-01T00:00:00.000Z' }],
      },
    ],
    operationalWindow: {
      startAt: '2026-10-24T12:00:00.000Z',
      endAt: '2026-10-24T20:00:00.000Z',
    },
    sla: { dueAt: '2026-10-24T20:00:00.000Z', at: AT },
    documents: [],
    situations: [],
    contractRestrictions: [],
    requiresDriver: true,
    requiresVehicle: true,
    requiresEquipment: false,
    ...overrides,
  };
}

describe('evaluateDispatchReadiness — agregado', () => {
  it('ordem completa é despachável', () => {
    const result = evaluateDispatchReadiness(baseFacts());
    expect(result.ready).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
    expect(result.nextAction).toBeNull();
    expect(result.status).toBe('READY');
  });

  it('toda dimensão do vocabulário é avaliada — nenhuma é omitida', () => {
    const result = evaluateDispatchReadiness(baseFacts());
    expect(result.dimensions.map((item) => item.dimension)).toEqual([
      ...DISPATCH_READINESS_DIMENSIONS,
    ]);
  });

  it('dimensão NÃO aplicável não é READY — a distinção importa', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({ requiresEquipment: false, requiresVehicle: false, requiresDriver: false }),
    );
    const equipment = result.dimensions.find((item) => item.dimension === 'EQUIPMENT');
    expect(equipment?.status).toBe('NOT_APPLICABLE');
  });

  it('bloqueio aponta SEMPRE um motivo e uma resolução', () => {
    const result = evaluateDispatchReadiness(baseFacts({ allocations: [] }));
    expect(result.ready).toBe(false);
    for (const blocker of result.blockingReasons) {
      expect(blocker.reasonCode).toBeTruthy();
      expect(blocker.resolution).toBeTruthy();
      expect(blocker.reason).toBeTruthy();
    }
  });

  it('bloqueios são devolvidos TODOS, não só o primeiro', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        allocations: [],
        operationalWindow: null,
      }),
    );
    const codes = result.blockingReasons.map((item) => item.reasonCode);
    expect(codes).toContain(DISPATCH_BLOCK_REASONS.RESERVATION_MISSING);
    expect(codes).toContain(DISPATCH_BLOCK_REASONS.OPERATIONAL_WINDOW_MISSING);
    expect(result.blockingReasons.length).toBeGreaterThan(1);
  });

  it('a saída é determinística: mesma entrada, mesmo resultado', () => {
    const facts = baseFacts();
    const first = evaluateDispatchReadiness(facts);
    const second = evaluateDispatchReadiness(facts);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('não muta os fatos recebidos', () => {
    const facts = baseFacts();
    const snapshot = JSON.stringify(facts);
    evaluateDispatchReadiness(facts);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});

describe('PLANNING', () => {
  it('sem plano, o despacho não acontece', () => {
    const result = evaluateDispatchReadiness(baseFacts({ plannedResources: [] }));
    const planning = result.dimensions.find((item) => item.dimension === 'PLANNING');
    expect(planning?.status).toBe('BLOCKED');
    expect(planning?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.PLANNING_NOT_CONFIRMED);
    expect(planning?.resolution).toBe(DISPATCH_RESOLUTION_CODES.CONFIRM_PLANNING);
  });

  it('plano abaixo do mínimo exigido bloqueia com o motivo do requisito', () => {
    const facts = baseFacts();
    facts.plannedResources = facts.plannedResources.map((item) =>
      item.requirementKind === 'PHYSICAL_RESOURCE' ? { ...item, plannedQuantity: '0.5' } : item,
    );
    const result = evaluateDispatchReadiness(facts);
    const planning = result.dimensions.find((item) => item.dimension === 'PLANNING');
    expect(planning?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.MINIMUM_RESOURCES_NOT_PLANNED);
  });

  it('requisito OPCIONAL não bloqueia', () => {
    const facts = baseFacts();
    facts.requirements = [
      { ...facts.requirements[0]!, requirementLevel: 'OPTIONAL', minQuantity: '5' },
    ];
    const result = evaluateDispatchReadiness(facts);
    const planning = result.dimensions.find((item) => item.dimension === 'PLANNING');
    expect(planning?.status).toBe('READY');
  });

  it('recurso planejado REMOVIDO não conta para cobertura', () => {
    const facts = baseFacts();
    facts.plannedResources = facts.plannedResources.map((item) => ({
      ...item,
      status: 'REMOVED',
    }));
    const result = evaluateDispatchReadiness(facts);
    expect(result.dimensions.find((item) => item.dimension === 'PLANNING')?.status).toBe('BLOCKED');
  });
});

describe('RESERVATION', () => {
  it('sem reserva nominal a ordem não sai', () => {
    const result = evaluateDispatchReadiness(baseFacts({ allocations: [] }));
    const reservation = result.dimensions.find((item) => item.dimension === 'RESERVATION');
    expect(reservation?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.RESERVATION_MISSING);
    expect(reservation?.resolution).toBe(DISPATCH_RESOLUTION_CODES.RESERVE_RESOURCES);
  });

  it('reserva que NÃO cobre a janela bloqueia', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) => ({
      ...item,
      operationalStart: '2026-10-24T13:00:00.000Z',
      operationalEnd: '2026-10-24T19:00:00.000Z',
    }));
    const result = evaluateDispatchReadiness(facts);
    const reservation = result.dimensions.find((item) => item.dimension === 'RESERVATION');
    expect(reservation?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.RESERVATION_WINDOW_MISMATCH);
    expect(reservation?.resolution).toBe(DISPATCH_RESOLUTION_CODES.ADJUST_RESERVATION_WINDOW);
  });

  it('reserva de recurso inativo bloqueia e aponta o recurso', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) =>
      item.id === 'al-1' ? { ...item, resourceActive: false } : item,
    );
    const result = evaluateDispatchReadiness(facts);
    const reservation = result.dimensions.find((item) => item.dimension === 'RESERVATION');
    expect(reservation?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.RESERVATION_RESOURCE_INACTIVE);
    expect(reservation?.resource?.code).toBe('VEH-027');
  });

  it('alocação não-ACTIVE é ignorada (REALLOCATED não reserva)', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        allocations: baseFacts().allocations.map((a) => ({ ...a, status: 'REALLOCATED' })),
      }),
    );
    expect(result.dimensions.find((item) => item.dimension === 'RESERVATION')?.reasonCode).toBe(
      DISPATCH_BLOCK_REASONS.RESERVATION_MISSING,
    );
  });
});

describe('CREW / DRIVER / VEHICLE / EQUIPMENT', () => {
  it('sem pessoa escalada, CREW bloqueia', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.filter(
      (item) => item.resourceKind !== 'WORKFORCE_MEMBER',
    );
    const result = evaluateDispatchReadiness(facts);
    expect(result.dimensions.find((item) => item.dimension === 'CREW')?.reasonCode).toBe(
      DISPATCH_BLOCK_REASONS.CREW_NOT_CONFIRMED,
    );
  });

  it('condutor inativo bloqueia com REASSIGN_DRIVER', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) =>
      item.resourceKind === 'WORKFORCE_MEMBER' ? { ...item, resourceActive: false } : item,
    );
    const result = evaluateDispatchReadiness(facts);
    const driver = result.dimensions.find((item) => item.dimension === 'DRIVER');
    expect(driver?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.DRIVER_INACTIVE);
    expect(driver?.resolution).toBe(DISPATCH_RESOLUTION_CODES.REASSIGN_DRIVER);
    expect(driver?.resource?.code).toBe('DRV-019');
  });

  it('serviço sem deslocamento não avalia condutor (NOT_APPLICABLE)', () => {
    const facts = baseFacts({
      requiresDriver: false,
      requiresVehicle: false,
      allocations: [
        {
          id: 'al-3',
          resourceTypeCode: 'EQUIPAMENTO',
          operationalStart: '2026-10-24T12:00:00.000Z',
          operationalEnd: '2026-10-24T20:00:00.000Z',
          status: 'ACTIVE',
          resourceKind: 'PHYSICAL_ASSET',
          resourceCode: 'EQP-1',
          resourceLabel: 'Betoneira',
          resourceActive: true,
          underMaintenance: false,
          requiresDriver: false,
          qualifications: [],
        },
      ],
    });
    const result = evaluateDispatchReadiness(facts);
    expect(result.dimensions.find((item) => item.dimension === 'DRIVER')?.status).toBe(
      'NOT_APPLICABLE',
    );
  });

  it('veículo exigido e ausente bloqueia', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.filter((item) => item.resourceKind !== 'PHYSICAL_ASSET');
    const result = evaluateDispatchReadiness(facts);
    expect(result.dimensions.find((item) => item.dimension === 'VEHICLE')?.reasonCode).toBe(
      DISPATCH_BLOCK_REASONS.VEHICLE_NOT_ASSIGNED,
    );
  });

  it('equipamento exigido e ausente bloqueia', () => {
    const result = evaluateDispatchReadiness(baseFacts({ requiresEquipment: true }));
    expect(result.dimensions.find((item) => item.dimension === 'EQUIPMENT')?.reasonCode).toBe(
      DISPATCH_BLOCK_REASONS.EQUIPMENT_NOT_ASSIGNED,
    );
  });
});

describe('QUALIFICATION', () => {
  it('habilitação vencida bloqueia e diz qual e quando', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) =>
      item.id === 'al-2'
        ? { ...item, qualifications: [{ code: 'MOPP', expiresAt: '2026-10-22T00:00:00.000Z' }] }
        : item,
    );
    const result = evaluateDispatchReadiness(facts);
    const qualification = result.dimensions.find((item) => item.dimension === 'QUALIFICATION');
    expect(qualification?.status).toBe('BLOCKED');
    expect(qualification?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.QUALIFICATION_EXPIRED);
    expect(qualification?.qualificationCode).toBe('MOPP');
    expect(qualification?.dueAt).toBe('2026-10-22T00:00:00.000Z');
    expect(qualification?.resource?.code).toBe('DRV-019');
    expect(qualification?.resolution).toBe(DISPATCH_RESOLUTION_CODES.REGISTER_QUALIFICATION);
  });

  it('habilitação válida não bloqueia', () => {
    const result = evaluateDispatchReadiness(baseFacts());
    expect(result.dimensions.find((item) => item.dimension === 'QUALIFICATION')?.status).toBe(
      'READY',
    );
  });

  it('habilitação sem vencimento declarado não bloqueia (não se inventa validade)', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) =>
      item.id === 'al-2' ? { ...item, qualifications: [{ code: 'CNH', expiresAt: null }] } : item,
    );
    const result = evaluateDispatchReadiness(facts);
    expect(result.dimensions.find((item) => item.dimension === 'QUALIFICATION')?.status).toBe(
      'READY',
    );
  });

  it('o vencimento é comparado com o INSTANTE da avaliação, não com o relógio', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) =>
      item.id === 'al-2'
        ? { ...item, qualifications: [{ code: 'MOPP', expiresAt: '2026-10-24T12:00:00.000Z' }] }
        : item,
    );
    // Exatamente no instante do vencimento: ainda vale (o limite é `< at`).
    expect(
      evaluateDispatchReadiness({ ...facts, sla: { dueAt: null, at: AT } }).dimensions.find(
        (item) => item.dimension === 'QUALIFICATION',
      )?.status,
    ).toBe('READY');

    // Um minuto depois: vencida.
    expect(
      evaluateDispatchReadiness({
        ...facts,
        sla: { dueAt: null, at: '2026-10-24T12:01:00.000Z' },
      }).dimensions.find((item) => item.dimension === 'QUALIFICATION')?.status,
    ).toBe('BLOCKED');
  });
});

describe('MAINTENANCE', () => {
  it('ativo em manutenção bloqueia', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) =>
      item.id === 'al-1' ? { ...item, underMaintenance: true } : item,
    );
    const result = evaluateDispatchReadiness(facts);
    const maintenance = result.dimensions.find((item) => item.dimension === 'MAINTENANCE');
    expect(maintenance?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.MAINTENANCE_OPEN);
    expect(maintenance?.resource?.code).toBe('VEH-027');
  });

  it('manutenção DESCONHECIDA (null) é NÃO APLICÁVEL, não "sem manutenção"', () => {
    /**
     * O schema atual não tem tabela de ordem de manutenção. Se o fato vem `null`,
     * o sistema não pode afirmar que o ativo está livre — isso seria inventar um
     * fato. A dimensão fica NÃO APLICÁVEL e a lacuna fica visível.
     */
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) => ({
      ...item,
      underMaintenance: null,
    }));
    const result = evaluateDispatchReadiness(facts);
    expect(result.dimensions.find((item) => item.dimension === 'MAINTENANCE')?.status).toBe(
      'NOT_APPLICABLE',
    );
  });

  it('manutenção conhecida como FALSA é READY', () => {
    const facts = baseFacts();
    facts.allocations = facts.allocations.map((item) => ({
      ...item,
      underMaintenance: false,
    }));
    const result = evaluateDispatchReadiness(facts);
    expect(result.dimensions.find((item) => item.dimension === 'MAINTENANCE')?.status).toBe(
      'READY',
    );
  });
});

describe('DOCUMENTS', () => {
  it('documento obrigatório ausente bloqueia', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        documents: [
          { code: 'MDFE', label: 'MDF-e autorizado', satisfied: false, documentId: null },
        ],
      }),
    );
    const documents = result.dimensions.find((item) => item.dimension === 'DOCUMENTS');
    expect(documents?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.REQUIRED_DOCUMENT_MISSING);
    expect(documents?.resource?.code).toBe('MDFE');
  });

  it('sem documento exigido, a dimensão não é aplicável', () => {
    const result = evaluateDispatchReadiness(baseFacts());
    expect(result.dimensions.find((item) => item.dimension === 'DOCUMENTS')?.status).toBe(
      'NOT_APPLICABLE',
    );
  });
});

describe('OPERATIONAL_WINDOW e SLA', () => {
  it('janela ausente bloqueia', () => {
    const result = evaluateDispatchReadiness(baseFacts({ operationalWindow: null }));
    expect(
      result.dimensions.find((item) => item.dimension === 'OPERATIONAL_WINDOW')?.reasonCode,
    ).toBe(DISPATCH_BLOCK_REASONS.OPERATIONAL_WINDOW_MISSING);
  });

  it('janela já encerrada bloqueia com RESCHEDULE_WINDOW', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        operationalWindow: {
          startAt: '2026-10-24T08:00:00.000Z',
          endAt: '2026-10-24T10:00:00.000Z',
        },
      }),
    );
    const window = result.dimensions.find((item) => item.dimension === 'OPERATIONAL_WINDOW');
    expect(window?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.OPERATIONAL_WINDOW_EXPIRED);
    expect(window?.resolution).toBe(DISPATCH_RESOLUTION_CODES.RESCHEDULE_WINDOW);
  });

  it('SLA vencido BLOQUEIA o despacho e a saída é escalonar', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({ sla: { dueAt: '2026-10-24T11:00:00.000Z', at: AT } }),
    );
    const sla = result.dimensions.find((item) => item.dimension === 'SLA');
    expect(sla?.reasonCode).toBe(DISPATCH_BLOCK_REASONS.SLA_ALREADY_BREACHED);
    expect(sla?.resolution).toBe(DISPATCH_RESOLUTION_CODES.ESCALATE);
  });

  it('serviço sem prazo publicado não é avaliado por SLA', () => {
    const result = evaluateDispatchReadiness(baseFacts({ sla: { dueAt: null, at: AT } }));
    expect(result.dimensions.find((item) => item.dimension === 'SLA')?.status).toBe(
      'NOT_APPLICABLE',
    );
  });
});

describe('CONTRACT_RESTRICTIONS e situações', () => {
  it('restrição contratual ativa bloqueia', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        contractRestrictions: [
          { code: 'CLIENT_WINDOW_ONLY', label: 'Somente na janela do cliente', active: true },
        ],
      }),
    );
    const restriction = result.dimensions.find(
      (item) => item.dimension === 'CONTRACT_RESTRICTIONS',
    );
    expect(restriction?.status).toBe('BLOCKED');
    expect(restriction?.resolution).toBe(DISPATCH_RESOLUTION_CODES.REVIEW_CONTRACT);
  });

  it('exigência de assinatura é AVISO, não bloqueio de despacho', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        contractRestrictions: [
          { code: 'REQUIRES_CUSTOMER_SIGNATURE', label: 'Assinatura obrigatória', active: true },
        ],
      }),
    );
    const evidence = result.dimensions.find((item) => item.dimension === 'EVIDENCE_REQUIREMENTS');
    expect(evidence?.status).toBe('WARNING');
    // Aviso não impede o despacho.
    expect(result.ready).toBe(true);
    expect(result.warnings.length).toBe(1);
  });

  it('situação de bloqueio aberta impede o despacho', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        situations: [
          { code: 'DOCUMENT_HOLD', severity: 'P1', title: 'Documento retido', blocking: true },
        ],
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.blockingReasons.map((item) => item.reasonCode)).toContain(
      DISPATCH_BLOCK_REASONS.BLOCKING_SITUATION_OPEN,
    );
    expect(result.nextAction).toBe(DISPATCH_RESOLUTION_CODES.RESOLVE_SITUATION);
  });

  it('situação NÃO bloqueante não impede o despacho', () => {
    const result = evaluateDispatchReadiness(
      baseFacts({
        situations: [{ code: 'INFO', severity: 'P4', title: 'Aviso', blocking: false }],
      }),
    );
    expect(result.ready).toBe(true);
  });
});

describe('rótulos e status', () => {
  it('todo motivo tem texto humano — nenhum código cru chega à tela', () => {
    for (const code of Object.values(DISPATCH_BLOCK_REASONS)) {
      const text = describeDispatchReason(code);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toBe(code);
    }
  });

  it('toda resolução tem texto humano', () => {
    for (const code of Object.values(DISPATCH_RESOLUTION_CODES)) {
      expect(describeDispatchResolution(code)).not.toBe(code);
    }
  });

  it('só RELEASED é despachável', () => {
    expect(isDispatchableStatus(SERVICE_ORDER_STATUSES.Released)).toBe(true);
    for (const status of [
      SERVICE_ORDER_STATUSES.Draft,
      SERVICE_ORDER_STATUSES.Prepared,
      SERVICE_ORDER_STATUSES.InExecution,
      SERVICE_ORDER_STATUSES.Paused,
      SERVICE_ORDER_STATUSES.Completed,
      SERVICE_ORDER_STATUSES.Cancelled,
    ]) {
      expect(isDispatchableStatus(status)).toBe(false);
    }
  });
});
