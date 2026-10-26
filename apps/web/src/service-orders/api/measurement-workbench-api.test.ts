import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../../auth/storage/token-store';
import {
  getMeasurementWorkQueue,
  getMeasurementWorkbench,
  getRevenueLeakage,
  MeasurementApiError,
  recordCustomerAcceptance,
  REVENUE_LEAKAGE_COLLECTION_PATHS,
  WORKBENCH_COLLECTION_PATHS,
} from './measurement-workbench-api';

function collectArrayPaths(typesSource: string, rootTypeName: string): string[] {
  const sourceFile = ts.createSourceFile(
    'measurement-workbench.types.ts',
    typesSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  sourceFile.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      declarations.set(node.name.text, node);
    }
  });
  const paths = new Set<string>();

  function visitMembers(
    members: ts.NodeArray<ts.TypeElement>,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
      const name = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
      visitType(member.type, [...prefix, name], stack);
    }
  }

  function visitNamed(
    name: string,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    if (stack.has(name)) return;
    const declaration = declarations.get(name);
    if (!declaration) return;
    const nextStack = new Set(stack);
    nextStack.add(name);
    if (ts.isInterfaceDeclaration(declaration)) {
      visitMembers(declaration.members, prefix, nextStack);
    } else {
      visitType(declaration.type, prefix, nextStack);
    }
  }

  function visitArrayElement(
    elementType: ts.TypeNode,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    if (prefix.length === 0) return;
    paths.add(prefix.join('.'));
    const last = prefix[prefix.length - 1];
    if (!last) return;
    visitType(elementType, [...prefix.slice(0, -1), last + '[]'], stack);
  }

  function visitType(
    type: ts.TypeNode,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    if (ts.isArrayTypeNode(type)) {
      visitArrayElement(type.elementType, prefix, stack);
      return;
    }
    if (ts.isTypeReferenceNode(type)) {
      const typeName = type.typeName.getText(sourceFile);
      if ((typeName === 'Array' || typeName === 'ReadonlyArray') && type.typeArguments?.[0]) {
        visitArrayElement(type.typeArguments[0], prefix, stack);
        return;
      }
      visitNamed(typeName, prefix, stack);
      return;
    }
    if (ts.isTypeLiteralNode(type)) {
      visitMembers(type.members, prefix, stack);
      return;
    }
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
      for (const child of type.types) visitType(child, prefix, stack);
      return;
    }
    if (ts.isParenthesizedTypeNode(type) || ts.isTypeOperatorNode(type)) {
      visitType(type.type, prefix, stack);
    }
  }

  visitNamed(rootTypeName, [], new Set());
  return [...paths].sort();
}

function configuredPaths(paths: ReadonlyArray<readonly string[]>): string[] {
  return paths.map((path) => path.join('.')).sort();
}

function validWorkbench(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    identity: {
      measurementId: null,
      number: null,
      serviceOrderId: 'so-1',
      orderNumber: 'OS-1',
      rowVersion: null,
    },
    businessContext: {
      company: null,
      unit: 'UN-PROD-001',
      customer: null,
      customerId: null,
      contract: null,
      purchaseOrder: null,
      responsible: null,
    },
    statuses: {
      execution: 'COMPLETED',
      measurement: 'DRAFT',
      acceptance: 'NOT_APPLICABLE',
      billingEligibility: 'BLOCKED',
      billing: 'NOT_STARTED',
      accounting: 'NOT_APPLICABLE',
    },
    processContext: {
      milestones: [],
      completedMilestones: [],
      pendingMilestones: [],
      health: {
        currentStage: 'MEASUREMENT',
        currentStageLabel: 'Medição',
        elapsedSeconds: null,
        targetSeconds: null,
        forecastSecondsRemaining: null,
        risk: 'LOW',
        riskReason: '',
        ownerRole: 'OPERATIONS',
        blockingReason: null,
        nextMilestone: null,
      },
      nextMilestone: null,
    },
    measurementBasis: {
      basisId: null,
      executionClosureId: null,
      preparedAt: null,
      lineCount: 0,
      lines: [],
    },
    quantities: {
      lines: [],
      totals: { planned: 0, actual: 0, measured: 0 },
    },
    economics: {
      grossValue: null,
      currency: null,
      financialVariance: null,
      revenueExposure: null,
    },
    commercialContext: {
      pricing: { source: null, lineCount: 0, currencyCode: null },
      paymentTerms: null,
      tolerance: { percentage: 0, source: 'TEST' },
      purchaseOrderRequirement: null,
      billingPolicy: 'TEST',
    },
    variances: [],
    varianceSummary: {
      highestSeverity: 'NONE',
      decisionRequiredCount: 0,
      approvalClearable: true,
      summary: '',
    },
    adjustments: [],
    items: [],
    evidence: [],
    acceptance: {
      policy: 'NONE',
      policySource: 'TEST',
      policyReason: '',
      required: false,
      state: 'NOT_APPLICABLE',
      blocksBilling: false,
      blockingReason: null,
      latest: null,
      history: [],
      nextActionCode: null,
      nextActionLabel: null,
    },
    billingEligibility: {
      result: 'BLOCKED',
      dimensions: [],
      blockingReasons: [],
      nextAction: null,
      totalAmount: null,
      currencyCode: null,
      summary: '',
      explanation: '',
    },
    situations: [],
    relationships: [],
    documentFlow: [],
    timeline: [],
    nextAction: null,
    availableCommands: [],
    decisionExplanation: {
      measurement: '',
      approval: '',
      acceptance: '',
      billing: '',
      onBilling: '',
    },
    freshness: { readAt: '2026-10-26T00:00:00.000Z', authority: 'SERVER' },
    ...overrides,
  };
}

function validQueue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    context: { unitId: 'UN-PROD-001', at: '2026-10-26T00:00:00.000Z' },
    counts: {},
    items: [],
    freshness: { readAt: '2026-10-26T00:00:00.000Z', authority: 'SERVER' },
    ...overrides,
  };
}

function validLeakage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    context: { unitId: 'UN-PROD-001', at: '2026-10-26T00:00:00.000Z' },
    stages: [],
    total: { count: 0, amount: null, unknownAmountCount: 0, currencyCode: null },
    positions: [],
    freshness: { readAt: '2026-10-26T00:00:00.000Z', authority: 'SERVER' },
    ...overrides,
  };
}

async function expectContractFailure(promise: Promise<unknown>, code?: string): Promise<void> {
  try {
    await promise;
    throw new Error('esperava MeasurementApiError de contrato');
  } catch (error) {
    expect(error).toBeInstanceOf(MeasurementApiError);
    const typed = error as MeasurementApiError;
    expect(typed.kind).toBe('contract');
    if (code) expect(typed.code).toBe(code);
  }
}

describe('measurement HTTP runtime contract — fail closed', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    tokenStore.setTokens('test-access-token', 'test-refresh-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tokenStore.clear();
  });

  function mockJson(body: unknown) {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('aceita fila válida e preserva contexto autoritativo', async () => {
    mockJson(validQueue());
    const queue = await getMeasurementWorkQueue('UN-PROD-001');
    expect(queue.context.unitId).toBe('UN-PROD-001');
    expect(queue.items).toEqual([]);
  });

  it('fila sem items não vira falso "nenhum trabalho": falha contrato', async () => {
    const body = validQueue();
    delete body['items'];
    mockJson(body);
    await expectContractFailure(
      getMeasurementWorkQueue('UN-PROD-001'),
      'MEASUREMENT_QUEUE_CONTRACT_INVALID',
    );
  });

  it('fila de outra unidade é rejeitada', async () => {
    mockJson(validQueue({ context: { unitId: 'UN-ERRADA', at: '2026-10-26T00:00:00.000Z' } }));
    await expectContractFailure(
      getMeasurementWorkQueue('UN-PROD-001'),
      'MEASUREMENT_QUEUE_UNIT_MISMATCH',
    );
  });

  it('workbench válido atravessa o boundary sem reescrever negócio', async () => {
    mockJson(validWorkbench());
    const workbench = await getMeasurementWorkbench('so-1');
    expect(workbench.identity.serviceOrderId).toBe('so-1');
    expect(workbench.availableCommands).toEqual([]);
    expect(workbench.quantities.lines).toEqual([]);
  });

  it('coleção ausente no workbench falha fechado em vez de virar []', async () => {
    const body = validWorkbench();
    const quantities = body['quantities'] as Record<string, unknown>;
    delete quantities['lines'];
    mockJson(body);
    await expectContractFailure(
      getMeasurementWorkbench('so-1'),
      'MEASUREMENT_WORKBENCH_COLLECTION_INVALID',
    );
  });

  it('pai obrigatório ausente vira erro de contrato controlado', async () => {
    const body = validWorkbench();
    delete body['processContext'];
    mockJson(body);
    await expectContractFailure(
      getMeasurementWorkbench('so-1'),
      'MEASUREMENT_WORKBENCH_COLLECTION_INVALID',
    );
  });

  it('workbench de outra OS é rejeitado', async () => {
    mockJson(
      validWorkbench({
        identity: {
          measurementId: null,
          number: null,
          serviceOrderId: 'so-outra',
          orderNumber: 'OS-OUTRA',
          rowVersion: null,
        },
      }),
    );
    await expectContractFailure(
      getMeasurementWorkbench('so-1'),
      'MEASUREMENT_WORKBENCH_SERVICE_ORDER_MISMATCH',
    );
  });

  it('comando incompleto não chega ao React', async () => {
    mockJson(
      validWorkbench({
        availableCommands: [
          {
            code: 'APPROVE',
            label: 'Aprovar',
            enabled: false,
            blockingReasons: [],
            nextAction: null,
            requiredPermission: 'measurement:approve',
          },
        ],
      }),
    );
    await expectContractFailure(
      getMeasurementWorkbench('so-1'),
      'MEASUREMENT_WORKBENCH_COLLECTION_INVALID',
    );
  });

  it('retorno do aceite precisa corresponder à mesma OS e medição', async () => {
    mockJson(
      validWorkbench({
        identity: {
          measurementId: 'm-1',
          number: 'M-1',
          serviceOrderId: 'so-1',
          orderNumber: 'OS-1',
          rowVersion: 2,
        },
      }),
    );
    const result = await recordCustomerAcceptance('so-1', 'm-1', {
      expectedVersion: 1,
      idempotencyKey: 'key-1',
      result: 'ACCEPTED',
      observation: 'Conforme.',
    });
    expect(result.identity.measurementId).toBe('m-1');
  });

  it('revenue leakage não aceita contexto de outra unidade', async () => {
    mockJson(validLeakage({ context: { unitId: 'UN-ERRADA', at: '2026-10-26T00:00:00.000Z' } }));
    await expectContractFailure(
      getRevenueLeakage('UN-PROD-001'),
      'MEASUREMENT_REVENUE_LEAKAGE_UNIT_MISMATCH',
    );
  });


  const elementMutations: Array<{
    name: string;
    code: string;
    mutate: (body: Record<string, unknown>) => void;
  }> = [
    {
      name: 'variances',
      code: 'MEASUREMENT_WORKBENCH_VARIANCE_INVALID',
      mutate: (body) => {
        body['variances'] = [{
          dimension: 'Quantidade',
          dimensionKey: 'DAY',
          plannedValue: null,
          actualValue: '1',
          measuredValue: '1',
          absoluteDelta: '0',
          percentageDelta: null,
          tolerancePercentage: 'INVALID',
          toleranceSource: 'CONTRACT',
          severity: 'LOW',
          financialImpact: null,
          currencyCode: null,
          requiresDecision: false,
          decisionKind: 'NONE',
          blockingReason: null,
          recommendedResolution: null,
          explanation: 'ok',
        }];
      },
    },
    {
      name: 'quantities.lines',
      code: 'MEASUREMENT_WORKBENCH_QUANTITY_LINE_INVALID',
      mutate: (body) => {
        const quantities = body['quantities'] as Record<string, unknown>;
        quantities['lines'] = [{
          dimensionKey: 'DAY',
          label: 123,
          unitOfMeasure: 'DAY',
          planned: null,
          actual: '1',
          measured: '1',
        }];
      },
    },
    {
      name: 'items',
      code: 'MEASUREMENT_WORKBENCH_ITEM_INVALID',
      mutate: (body) => {
        body['items'] = [{
          id: 'i-1',
          lineNumber: '1',
          unitCode: 'DAY',
          actualQuantity: '1',
          measuredQuantity: '1',
          unitPrice: null,
          lineAmount: null,
          origin: 'BASIS',
        }];
      },
    },
    {
      name: 'acceptance.history',
      code: 'MEASUREMENT_WORKBENCH_ACCEPTANCE_HISTORY_INVALID',
      mutate: (body) => {
        const acceptance = body['acceptance'] as Record<string, unknown>;
        acceptance['history'] = [{
          id: 'a-1',
          cycleNumber: '1',
          result: 'ACCEPTED',
          rejectionReason: null,
          occurredAt: '2026-10-26T00:00:00.000Z',
        }];
      },
    },
    {
      name: 'billingEligibility.dimensions',
      code: 'MEASUREMENT_WORKBENCH_ELIGIBILITY_DIMENSION_INVALID',
      mutate: (body) => {
        const eligibility = body['billingEligibility'] as Record<string, unknown>;
        eligibility['dimensions'] = [{
          dimension: 'ACCEPTANCE',
          label: 'Aceite',
          status: 'SATISFIED',
          statusLabel: 'Atendido',
          reasonCode: null,
          detail: 'ok',
          nextActionCode: null,
          nextActionLabel: null,
          blocking: 'false',
        }];
      },
    },
    {
      name: 'processContext.milestones',
      code: 'MEASUREMENT_WORKBENCH_MILESTONE_INVALID',
      mutate: (body) => {
        const processContext = body['processContext'] as Record<string, unknown>;
        processContext['milestones'] = [{
          stage: 'MEASUREMENT',
          label: undefined,
          state: 'CURRENT',
          reachedAt: null,
        }];
      },
    },
    {
      name: 'availableCommands',
      code: 'MEASUREMENT_WORKBENCH_COMMAND_INVALID',
      mutate: (body) => {
        body['availableCommands'] = [{
          code: 'APPROVE',
          label: 'Aprovar',
          enabled: false,
          blockingReasons: [],
          reasonLabels: ['ok', 7],
          nextAction: null,
          requiredPermission: 'measurement:approve',
        }];
      },
    },
  ];

  it.each(elementMutations)(
    'mutation: elemento inválido em $name falha fechado',
    async ({ code, mutate }) => {
      const body = validWorkbench();
      mutate(body);
      mockJson(body);
      await expectContractFailure(getMeasurementWorkbench('so-1'), code);
    },
  );

  it('fitness: todas as coleções têm caminho completo no runtime gate', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const typesSource = fs.readFileSync(
      path.join(here, '..', 'types', 'measurement-workbench.types.ts'),
      'utf8',
    );

    expect(configuredPaths(WORKBENCH_COLLECTION_PATHS)).toEqual(
      collectArrayPaths(typesSource, 'MeasurementWorkbenchReadModel'),
    );
    expect(configuredPaths(REVENUE_LEAKAGE_COLLECTION_PATHS)).toEqual(
      collectArrayPaths(typesSource, 'RevenueLeakageReadModel'),
    );
  });
});
