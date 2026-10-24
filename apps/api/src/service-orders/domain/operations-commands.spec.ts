import { describe, expect, it } from 'vitest';
import { evaluateCompletionGate, type CompletionFacts } from './completion-gate';
import { evaluateDispatchReadiness, type DispatchFacts } from './dispatch-readiness';
import {
  OPERATIONS_COMMANDS,
  buildCommandSurface,
  type AvailableCommand,
  type OperationsCommandCode,
} from './operations-commands';
import { SERVICE_ORDER_STATUSES } from './service-order';

/**
 * COMMAND SURFACE — o BACKEND decide o que está habilitado.
 *
 * A regra que estes testes protegem é a razão de o módulo existir: NÃO EXISTE
 * segunda implementação de "pode concluir?" nem de "pode despachar?". A superfície
 * lê o gate e o readiness; não recalcula.
 */

const AT = '2026-10-24T12:00:00.000Z';

function dispatchFacts(overrides: Partial<DispatchFacts> = {}): DispatchFacts {
  return {
    serviceOrderId: 'so-1',
    status: SERVICE_ORDER_STATUSES.Released,
    requirements: [],
    plannedResources: [
      {
        id: 'pr-1',
        requirementKind: 'PHYSICAL_RESOURCE',
        resourceTypeCode: 'VEICULO',
        laborTypeCode: null,
        plannedQuantity: '1',
        operationalStart: AT,
        operationalEnd: '2026-10-24T20:00:00.000Z',
        status: 'PLANNED',
      },
    ],
    allocations: [
      {
        id: 'al-1',
        resourceTypeCode: 'VEICULO',
        operationalStart: AT,
        operationalEnd: '2026-10-24T20:00:00.000Z',
        status: 'ACTIVE',
        resourceKind: 'PHYSICAL_ASSET',
        resourceCode: 'VEH-027',
        resourceLabel: null,
        resourceActive: true,
        underMaintenance: false,
        requiresDriver: true,
        qualifications: [],
      },
      {
        id: 'al-2',
        resourceTypeCode: 'MOTORISTA',
        operationalStart: AT,
        operationalEnd: '2026-10-24T20:00:00.000Z',
        status: 'ACTIVE',
        resourceKind: 'WORKFORCE_MEMBER',
        resourceCode: 'DRV-019',
        resourceLabel: null,
        resourceActive: true,
        underMaintenance: false,
        requiresDriver: true,
        qualifications: [],
      },
    ],
    operationalWindow: { startAt: AT, endAt: '2026-10-24T20:00:00.000Z' },
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

function completionFacts(overrides: Partial<CompletionFacts> = {}): CompletionFacts {
  return {
    serviceOrderId: 'so-1',
    status: SERVICE_ORDER_STATUSES.InExecution,
    requirements: {
      requiresFinalOdometer: false,
      requiresFinalHourMeter: false,
      requiresFuel: false,
      requiresLaborHours: false,
      requiresEquipmentHours: false,
      requiresMaterial: false,
      requiresCustomerSignature: false,
      requiresMeasuredQuantity: false,
    },
    evidence: [],
    actuals: {
      finalOdometerRecorded: false,
      finalHourMeterRecorded: false,
      fuelRecorded: false,
      laborHoursByMember: [],
      equipmentHoursRecorded: false,
      materialRecorded: false,
      measuredQuantityRecorded: false,
    },
    signature: { registered: false, signerName: null, signedAt: null },
    situations: [],
    assignedWorkforceMemberIds: [],
    resources: { vehicles: [], equipment: [] },
    ...overrides,
  };
}

function surface(input: {
  status: (typeof SERVICE_ORDER_STATUSES)[keyof typeof SERVICE_ORDER_STATUSES];
  dispatch?: Partial<DispatchFacts>;
  completion?: Partial<CompletionFacts>;
  dispatchedAt?: string | null;
  checkedInAt?: string | null;
  hasBlockingSituation?: boolean;
  permissions?: string[];
}) {
  const all = Object.values({
    'service-orders:service-order:dispatch': true,
    'service-orders:execution:start': true,
    'service-orders:execution:pause': true,
    'service-orders:execution:resume': true,
    'service-orders:execution:record': true,
    'service-orders:execution:complete': true,
    'service-orders:service-order:cancel': true,
  });
  void all;
  const granted = new Set(
    input.permissions ?? [
      'service-orders:service-order:dispatch',
      'service-orders:execution:start',
      'service-orders:execution:pause',
      'service-orders:execution:resume',
      'service-orders:execution:record',
      'service-orders:execution:complete',
      'service-orders:service-order:cancel',
    ],
  );

  return buildCommandSurface({
    serviceOrderId: 'so-1',
    status: input.status,
    dispatchReadiness: evaluateDispatchReadiness(
      dispatchFacts({ status: input.status, ...input.dispatch }),
    ),
    completionGate: evaluateCompletionGate(
      completionFacts({ status: input.status, ...input.completion }),
    ),
    dispatchedAt: input.dispatchedAt ?? null,
    checkedInAt: input.checkedInAt ?? null,
    hasBlockingSituation: input.hasBlockingSituation ?? false,
    hasPermission: (permission) => granted.has(permission),
  });
}

function command(
  commands: AvailableCommand[],
  code: OperationsCommandCode,
): AvailableCommand | undefined {
  return commands.find((item) => item.code === code);
}

describe('DISPATCH — habilitado apenas quando a prontidão permite', () => {
  it('ordem pronta tem DISPATCH habilitado', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Released });
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.Dispatch)?.enabled).toBe(true);
  });

  it('ordem bloqueada tem DISPATCH desabilitado COM os motivos', () => {
    const result = surface({
      status: SERVICE_ORDER_STATUSES.Released,
      dispatch: {
        allocations: [],
        situations: [{ code: 'DOC', severity: 'P1', title: 'Documento retido', blocking: true }],
      },
    });
    const dispatch = command(result.availableCommands, OPERATIONS_COMMANDS.Dispatch);
    expect(dispatch?.enabled).toBe(false);
    expect(dispatch?.reasons.length).toBeGreaterThan(0);
    expect(dispatch?.reasons).toContain('RESERVATION_MISSING');
    // Um motivo bloqueante é legível, não um código cru.
    expect(dispatch?.reasonLabels.every((label) => label.length > 5)).toBe(true);
  });

  it('ordem não liberada não pode ser despachada', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Draft });
    const dispatch = command(result.availableCommands, OPERATIONS_COMMANDS.Dispatch);
    expect(dispatch?.enabled).toBe(false);
    expect(dispatch?.reasons).toContain('NOT_RELEASED');
  });
});

describe('START — exige despacho e prontidão', () => {
  it('sem despacho, START está desabilitado apontando DISPATCH como saída', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Released, dispatchedAt: null });
    const start = command(result.availableCommands, OPERATIONS_COMMANDS.Start);
    expect(start?.enabled).toBe(false);
    expect(start?.reasons).toContain('SERVICE_NOT_DISPATCHED');
    expect(start?.nextAction).toBe(OPERATIONS_COMMANDS.Dispatch);
  });

  it('com despacho e prontidão, START está habilitado', () => {
    const result = surface({
      status: SERVICE_ORDER_STATUSES.Released,
      dispatchedAt: AT,
    });
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.Start)?.enabled).toBe(true);
  });

  it('em execução, START fica desabilitado (sem duplo início)', () => {
    const result = surface({
      status: SERVICE_ORDER_STATUSES.InExecution,
      dispatchedAt: AT,
    });
    const start = command(result.availableCommands, OPERATIONS_COMMANDS.Start);
    expect(start?.enabled).toBe(false);
    expect(start?.reasons).toContain('ALREADY_STARTED');
  });
});

describe('PAUSE / RESUME — mutuamente exclusivos', () => {
  it('em execução: PAUSE sim, RESUME não', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.Pause)?.enabled).toBe(true);
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.Resume)?.enabled).toBe(false);
  });

  it('pausada: RESUME sim, PAUSE não', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Paused, dispatchedAt: AT });
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.Resume)?.enabled).toBe(true);
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.Pause)?.enabled).toBe(false);
  });
});

describe('COMPLETE — a decisão é do gate, não da tela', () => {
  it('com o gate liberado, COMPLETE está habilitado', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.Complete)?.enabled).toBe(true);
  });

  it('com o gate bloqueado, COMPLETE fica desabilitado com os motivos do gate', () => {
    const result = surface({
      status: SERVICE_ORDER_STATUSES.InExecution,
      dispatchedAt: AT,
      completion: {
        requirements: { ...completionFacts().requirements, requiresFinalOdometer: true },
      },
    });
    const complete = command(result.availableCommands, OPERATIONS_COMMANDS.Complete);
    expect(complete?.enabled).toBe(false);
    expect(complete?.reasons).toContain('FINAL_ODOMETER_REQUIRED');
    expect(complete?.nextAction).toBe(OPERATIONS_COMMANDS.RegisterMeter);
  });

  it('a superfície NÃO recalcula a conclusão: espelha o gate', () => {
    const completion = completionFacts({
      status: SERVICE_ORDER_STATUSES.InExecution,
      requirements: { ...completionFacts().requirements, requiresFuel: true },
      actuals: { ...completionFacts().actuals, fuelRecorded: false },
    });
    const gate = evaluateCompletionGate(completion);
    const result = surface({
      status: SERVICE_ORDER_STATUSES.InExecution,
      dispatchedAt: AT,
      completion,
    });
    const complete = command(result.availableCommands, OPERATIONS_COMMANDS.Complete);
    expect(gate.canComplete).toBe(false);
    expect(complete?.enabled).toBe(false);
    expect(complete?.reasons).toEqual(gate.blockingReasons.map((item) => item.reasonCode));
  });
});

describe('comandos de captura', () => {
  it('todos exigem execução em andamento', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Released });
    for (const code of [
      OPERATIONS_COMMANDS.RegisterActual,
      OPERATIONS_COMMANDS.RegisterMeter,
      OPERATIONS_COMMANDS.RegisterFuel,
      OPERATIONS_COMMANDS.RegisterLabor,
      OPERATIONS_COMMANDS.RegisterEquipmentUsage,
      OPERATIONS_COMMANDS.RegisterMaterialUsage,
      OPERATIONS_COMMANDS.AttachEvidence,
      OPERATIONS_COMMANDS.RecordProgress,
    ]) {
      const cmd = command(result.availableCommands, code);
      expect(cmd?.enabled).toBe(false);
    }
  });

  it('em execução, permitem captura', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    for (const code of [
      OPERATIONS_COMMANDS.RegisterActual,
      OPERATIONS_COMMANDS.RegisterMeter,
      OPERATIONS_COMMANDS.RegisterFuel,
      OPERATIONS_COMMANDS.RegisterLabor,
      OPERATIONS_COMMANDS.AttachEvidence,
    ]) {
      expect(command(result.availableCommands, code)?.enabled).toBe(true);
    }
  });

  it('execução concluída não aceita mais captura', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Completed, dispatchedAt: AT });
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.RegisterActual)?.enabled).toBe(
      false,
    );
  });

  it('assinatura é aceita mesmo após a conclusão (o cliente assina depois)', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Completed, dispatchedAt: AT });
    expect(command(result.availableCommands, OPERATIONS_COMMANDS.RegisterSignature)?.enabled).toBe(
      true,
    );
  });
});

describe('autorização', () => {
  it('comando sem permissão fica DESABILITADO, não oculto', () => {
    const result = surface({
      status: SERVICE_ORDER_STATUSES.InExecution,
      dispatchedAt: AT,
      permissions: ['service-orders:execution:record'],
    });
    const complete = command(result.availableCommands, OPERATIONS_COMMANDS.Complete);
    // O comando EXISTE na lista: o operador precisa saber que ele existe.
    expect(complete).toBeDefined();
    expect(complete?.enabled).toBe(false);
    expect(complete?.reasons).toContain('NOT_AUTHORIZED');
  });

  it('todo comando declara a permissão exigida', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    for (const cmd of result.availableCommands) {
      expect(cmd.requiredPermission).toMatch(/^service-orders:/);
    }
  });
});

describe('próximo comando', () => {
  it('ordem pronta recomenda DISPATCH', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Released });
    expect(result.nextCommand).toBe(OPERATIONS_COMMANDS.Dispatch);
    expect(result.nextCommandLabel).toBeTruthy();
  });

  it('ordem em execução com tudo pronto recomenda COMPLETE', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    expect(result.nextCommand).toBe(OPERATIONS_COMMANDS.Complete);
  });

  it('conclusão bloqueada aponta o comando que destrava, não COMPLETE', () => {
    const result = surface({
      status: SERVICE_ORDER_STATUSES.InExecution,
      dispatchedAt: AT,
      completion: {
        requirements: { ...completionFacts().requirements, requiresFuel: true },
      },
    });
    expect(result.nextCommand).not.toBe(OPERATIONS_COMMANDS.Complete);
    expect(result.nextCommand).toBe(OPERATIONS_COMMANDS.RegisterFuel);
  });
});

describe('contrato de forma', () => {
  it('todo comando traz code, label, enabled, reasons, route e permissão', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    for (const cmd of result.availableCommands) {
      expect(cmd.code).toBeTruthy();
      expect(cmd.label.length).toBeGreaterThan(2);
      expect(typeof cmd.enabled).toBe('boolean');
      expect(Array.isArray(cmd.reasons)).toBe(true);
      expect(cmd.route).toContain('/app/service-orders/so-1');
      expect(cmd.requiredPermission).toBeTruthy();
    }
  });

  it('comando habilitado nunca carrega motivo', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    for (const cmd of result.availableCommands.filter((item) => item.enabled)) {
      expect(cmd.reasons).toHaveLength(0);
      expect(cmd.reasonLabels).toHaveLength(0);
    }
  });

  it('comando desabilitado sempre carrega ao menos um motivo', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.Released });
    for (const cmd of result.availableCommands.filter((item) => !item.enabled)) {
      expect(cmd.reasons.length).toBeGreaterThan(0);
    }
  });

  it('a rota do comando é derivada do backend, não inventada na tela', () => {
    const result = surface({ status: SERVICE_ORDER_STATUSES.InExecution, dispatchedAt: AT });
    const routes = new Set(result.availableCommands.map((item) => item.route));
    expect(routes.size).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.startsWith('/app/service-orders/')).toBe(true);
    }
  });
});
