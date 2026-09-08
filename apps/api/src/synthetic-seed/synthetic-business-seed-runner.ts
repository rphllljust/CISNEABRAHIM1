import type { Pool, PoolClient } from 'pg';
import {
  assertSyntheticBusinessSeedAllowed,
  compensateSyntheticScenario,
  ensureCatalogBaselineActor,
  ensureCisneServicePortfolioBaseline,
  findSyntheticNamespaceClientId,
  insertCatalogCategory,
  resolveSeedReferenceDate,
  syntheticExternalRef,
  syntheticPoNumber,
  syntheticVehiclePlate,
  SYNTHETIC_SEED_NAMESPACE,
  SYNTHETIC_SEED_UNIT_ID,
  withSyntheticSeedLock,
} from '@cisne/database';
import { buildDeterministicSyntheticClient } from '../master-business/synthetic-test-data';
import { ADDRESS_PURPOSES, CONTACT_PURPOSES } from '../clients/domain/client-status';
import {
  PROPOSAL_ACCEPTANCE_ORIGINS,
  PROPOSAL_PRICING_STRUCTURES,
} from '../commercial/domain/proposal';
import { PURCHASE_ORDER_PRICING_STRUCTURES } from '../commercial/domain/purchase-order';
import {
  SERVICE_REQUEST_ORIGINS,
} from '../requests/domain/service-request';
import { getUatScenario } from '../uat/uat-scenarios';
import { runUatVerticalScenario, type UatVerticalServices, type UatActor } from '../uat/uat-vertical-runner';
import { PLANNED_RESOURCE_KINDS } from '../service-orders/domain/resource-planning';
import {
  SYNTHETIC_BUSINESS_SCENARIOS,
  type SyntheticBusinessScenario,
} from './synthetic-business-scenarios';
import { isSyntheticScenarioComplete } from './synthetic-scenario-completion';

export type SyntheticSeedCounts = {
  clients: number;
  serviceDefinitions: number;
  proposals: number;
  purchaseOrders: number;
  serviceRequests: number;
  serviceOrders: number;
  resourceAllocations: number;
  executionEntries: number;
  measurements: number;
  billingRecords: number;
  billingDocuments: number;
  documents: number;
  notifications: number;
};

export type SyntheticScenarioRunResult = {
  key: string;
  outcome: 'created' | 'already_present' | 'skipped' | 'failed';
  error?: string;
};

export type SyntheticBusinessSeedResult = {
  namespace: string;
  unitId: string;
  referenceDateIso: string;
  scenarios: SyntheticScenarioRunResult[];
  counts: SyntheticSeedCounts;
};

export type SyntheticBusinessSeedOptions = {
  unitId?: string;
  scenarios?: SyntheticBusinessScenario[];
  failAfterScenarioKey?: string;
  /** Test-only: throw after creating client in partial flow. */
  injectFailureAfterClientCreate?: boolean;
};

type DbClient = Pool | PoolClient;

function formatSeedError(error: unknown): string {
  if (error && typeof error === 'object' && 'getResponse' in error && typeof error.getResponse === 'function') {
    const getResponse = (error as { getResponse: () => unknown }).getResponse;
    const body: unknown = getResponse();
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function collectSyntheticCounts(client: DbClient): Promise<SyntheticSeedCounts> {
  const queries: Array<[keyof SyntheticSeedCounts, string]> = [
    ['clients', `SELECT count(*)::int AS n FROM pty.clients WHERE external_erp_id LIKE '${SYNTHETIC_SEED_NAMESPACE}:%' OR legal_name LIKE 'TESTE — %'`],
    ['serviceDefinitions', `SELECT count(*)::int AS n FROM cat.service_definitions WHERE code LIKE 'SYN-%'`],
    ['proposals', 'SELECT count(*)::int AS n FROM com.proposals'],
    ['purchaseOrders', 'SELECT count(*)::int AS n FROM com.purchase_orders'],
    ['serviceRequests', 'SELECT count(*)::int AS n FROM sr.service_requests'],
    ['serviceOrders', 'SELECT count(*)::int AS n FROM so.service_orders'],
    ['resourceAllocations', 'SELECT count(*)::int AS n FROM res.resource_allocations'],
    ['executionEntries', 'SELECT count(*)::int AS n FROM so.execution_entries'],
    ['measurements', 'SELECT count(*)::int AS n FROM msr.measurements'],
    ['billingRecords', 'SELECT count(*)::int AS n FROM bil.billing_records'],
    ['billingDocuments', 'SELECT count(*)::int AS n FROM bil.billing_documents'],
    ['documents', 'SELECT count(*)::int AS n FROM doc.documents'],
    ['notifications', 'SELECT count(*)::int AS n FROM ntf.notifications'],
  ];

  const counts = {} as SyntheticSeedCounts;
  for (const [key, sql] of queries) {
    const result = await client.query<{ n: number }>(sql);
    counts[key] = result.rows[0]?.n ?? 0;
  }
  return counts;
}

async function planAndAllocateExcavator(
  services: UatVerticalServices,
  actor: UatActor,
  unitId: string,
  orderId: string,
  scenario: SyntheticBusinessScenario,
): Promise<void> {
  const resourceTypeCode = 'EXCAVATOR';
  const listed = await services.resourceTypesAccess.list(actor, { limit: 50, offset: 0 });
  const resourceType = listed.items.find((item) => item.code === resourceTypeCode);
  if (!resourceType) {
    throw new Error(`Resource type ${resourceTypeCode} not found`);
  }

  const suffix = scenario.key.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
  const planned = await services.planningAccess.planResource(actor, orderId, {
    requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
    resourceTypeCode,
    plannedQuantity: '1',
    operationalStart: '2026-07-01T08:00:00.000Z',
    operationalEnd: '2026-07-01T18:00:00.000Z',
  });
  const asset = await services.assetsAccess.create(actor, {
    assetCode: `SYN-${resourceTypeCode}-${suffix}`,
    resourceTypeId: resourceType.id,
    name: `TESTE — Ativo ${scenario.displayLabel}`,
    unitId,
    vehicle:
      resourceType.classification === 'VEHICLE'
        ? syntheticVehiclePlate(scenario.cnpjIndex, resourceTypeCode)
        : undefined,
  });
  await services.planningAccess.allocateResource(actor, orderId, {
    plannedResourceId: planned.id,
    physicalAssetId: asset.id,
    operationalStart: '2026-07-01T08:00:00.000Z',
    operationalEnd: '2026-07-01T18:00:00.000Z',
  });
}

async function runPartialFlow(
  services: UatVerticalServices,
  actor: UatActor,
  unitId: string,
  scenario: SyntheticBusinessScenario,
  _referenceDate: Date,
  options?: SyntheticBusinessSeedOptions,
): Promise<SyntheticScenarioRunResult> {
  const externalRef = syntheticExternalRef(scenario.key);

  const fictional = buildDeterministicSyntheticClient(
    scenario.displayLabel,
    scenario.key,
    scenario.cnpjIndex,
  );
  const suffix = scenario.key.toUpperCase().replace(/[^A-Z0-9]+/g, '-');

  try {
    const client = await services.clientAccess.create(actor, {
      legalName: fictional.legalName,
      tradeName: fictional.tradeName,
      taxId: fictional.taxId,
      externalErpId: externalRef,
      contacts: [
        {
          name: fictional.contactName,
          purpose: CONTACT_PURPOSES.Operational,
          phone: '69999000000',
        },
      ],
      addresses: [
        {
          purpose: ADDRESS_PURPOSES.Billing,
          street: 'Av. Sintética de Homologação',
          number: '100',
          city: fictional.city,
          state: 'RO',
          postalCode: '76800000',
          country: 'BR',
        },
      ],
    });

    if (options?.injectFailureAfterClientCreate) {
      throw new Error('SYNTHETIC_SEED_INJECTED_FAILURE:after_client_create');
    }

    if (scenario.flow.kind === 'client_inactive') {
      await services.clientAccess.deactivate(actor, client.id, client.version, 'Encerramento sintético de homologação');
      return { key: scenario.key, outcome: 'created' };
    }

    const categoryCode = `SYN-CAT-${suffix}`;
    const existingCategory = await services.pool.query<{ id: string }>(
      `SELECT id FROM cat.service_categories WHERE code = $1 LIMIT 1`,
      [categoryCode],
    );
    const category = existingCategory.rows[0]
      ? { categoryId: existingCategory.rows[0].id }
      : await insertCatalogCategory(services.pool, {
          code: categoryCode,
          name: 'TESTE — Catálogo sintético',
        });

    const existingPublished = await services.pool.query<{
      serviceDefinitionId: string;
      id: string;
    }>(
      `SELECT d.id AS "serviceDefinitionId", v.id
       FROM cat.service_definitions d
       INNER JOIN cat.service_definition_versions v ON v.service_definition_id = d.id
       WHERE d.code = $1 AND v.status = 'ACTIVE'
       ORDER BY v.version DESC
       LIMIT 1`,
      [`SYN-SRV-${suffix}`],
    );
    const published = existingPublished.rows[0]
      ? existingPublished.rows[0]
      : await (async () => {
          const draft = await services.catalogAccess.create(actor, {
            code: `SYN-SRV-${suffix}`,
            name: `TESTE — Serviço ${scenario.displayLabel}`,
            categoryId: category.categoryId,
            archetype: 'RENTAL',
            measurementMode: 'BY_PERIOD',
            measurementBasis: 'TIME',
            allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
            pricingModels: [
              { modelCode: 'GLOBAL_PRICE', salePrice: '2500.0000', internalCost: '1800.0000' },
            ],
            resourceRequirements: [{ resourceTypeCode: 'EXCAVATOR', requirementLevel: 'REQUIRED', minQuantity: 1, sortOrder: 0 }],
            laborRequirements: [],
            executionRequirements: [
              { requirementType: 'OBSERVATION', requirementLevel: 'REQUIRED' },
              { requirementType: 'QUANTITY', requirementLevel: 'REQUIRED' },
            ],
          });
          const definition = await services.catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
          return services.catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);
        })();

    const proposal = await services.proposalsAccess.create(actor, {
      clientId: client.id,
      unitId,
      title: `TESTE — Proposta ${scenario.displayLabel}`,
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: '7500.0000',
    });

    if (scenario.flow.kind === 'proposal_draft') {
      return { key: scenario.key, outcome: 'created' };
    }

    const issued = await services.proposalsAccess.issue(actor, proposal.proposal.id, 1, proposal.currentVersion!.rowVersion);

    if (scenario.flow.kind === 'proposal_issued') {
      return { key: scenario.key, outcome: 'created' };
    }

    if (scenario.flow.kind === 'proposal_rejected') {
      await services.proposalsAccess.reject(actor, proposal.proposal.id, 1, {
        rowVersion: issued.rowVersion,
        rejectionReason: 'TESTE — rejeição sintética de homologação',
      });
      return { key: scenario.key, outcome: 'created' };
    }

    if (scenario.flow.kind === 'proposal_expired') {
      await services.proposalsAccess.expire(actor, proposal.proposal.id, 1, issued.rowVersion);
      return { key: scenario.key, outcome: 'created' };
    }

    const accepted = await services.proposalsAccess.accept(actor, proposal.proposal.id, 1, {
      rowVersion: issued.rowVersion,
      acceptanceOriginCode: PROPOSAL_ACCEPTANCE_ORIGINS.InternalApproval,
    });

    const purchaseOrder = await services.purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId,
      poNumber: syntheticPoNumber(scenario.key),
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      paymentTerms: '30 DDL',
      items: [
        {
          lineNumber: 1,
          description: `TESTE — Item ${scenario.key}`,
          serviceDefinitionId: published.serviceDefinitionId,
          serviceDefinitionVersionId: published.id,
          quantity: '1.0000',
          unitCode: 'DAY',
          unitPrice: '2500.0000',
          lineTotal: '2500.0000',
        },
      ],
    });

    if (scenario.flow.kind === 'purchase_order_cancelled') {
      const registered = await services.purchaseOrdersAccess.register(actor, purchaseOrder.purchaseOrder.id, {
        rowVersion: purchaseOrder.purchaseOrder.rowVersion,
      });
      await services.purchaseOrdersAccess.cancel(actor, registered.purchaseOrder.id, {
        rowVersion: registered.purchaseOrder.rowVersion,
        cancellationReason: 'TESTE — cancelamento sintético',
      });
      return { key: scenario.key, outcome: 'created' };
    }

    const registeredPo = await services.purchaseOrdersAccess.register(actor, purchaseOrder.purchaseOrder.id, {
      rowVersion: purchaseOrder.purchaseOrder.rowVersion,
    });

    const request = await services.serviceRequestsAccess.create(actor, {
      unitId,
      originSource: SERVICE_REQUEST_ORIGINS.ProposalAcceptance,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      proposalId: accepted.proposalId,
      purchaseOrderId: registeredPo.purchaseOrder.id,
      description: `TESTE — Solicitação ${scenario.displayLabel}`,
    });
    const submitted = await services.serviceRequestsAccess.submit(actor, request.serviceRequest.id, {
      rowVersion: request.serviceRequest.rowVersion,
    });
    const reviewed = await services.serviceRequestsAccess.startReview(actor, request.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await services.serviceRequestsAccess.approve(actor, request.serviceRequest.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
    });
    const converted = await services.serviceRequestsAccess.convert(actor, request.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });

    const order = await services.serviceOrdersAccess.getById(
      actor,
      converted.serviceRequest.convertedServiceOrderId!,
    );
    const prepared = await services.serviceOrdersAccess.prepare(actor, order.id, { rowVersion: order.rowVersion });

    if (scenario.flow.kind === 'service_order_cancelled') {
      await services.serviceOrdersAccess.cancel(actor, prepared.id, {
        rowVersion: prepared.rowVersion,
        cancellationReason: 'TESTE — cancelamento sintético de OS',
      });
      return { key: scenario.key, outcome: 'created' };
    }

    const released = await services.serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });

    if (scenario.flow.kind === 'measurement_pending') {
      await planAndAllocateExcavator(services, actor, unitId, released.id, scenario);
    }

    const started = await services.executionAccess.start(actor, released.id, {
      rowVersion: released.rowVersion,
    });
    await services.executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'TESTE — execução sintética registrada',
    });
    const afterObservation = await services.serviceOrdersAccess.getById(actor, started.id);
    await services.executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '1',
      unitCode: 'DAY',
    });
    const afterQuantity = await services.serviceOrdersAccess.getById(actor, started.id);
    const completed = await services.executionAccess.complete(actor, afterQuantity.id, {
      rowVersion: afterQuantity.rowVersion,
    });

    if (scenario.flow.kind === 'measurement_pending') {
      await services.measurementsAccess.create(actor, completed.id);
      return { key: scenario.key, outcome: 'created' };
    }

    return { key: scenario.key, outcome: 'skipped', error: `Unhandled partial flow ${scenario.flow.kind}` };
  } catch (error) {
    throw new Error(formatSeedError(error));
  }
}

async function runScenario(
  services: UatVerticalServices,
  actor: UatActor,
  unitId: string,
  scenario: SyntheticBusinessScenario,
  referenceDate: Date,
  options?: SyntheticBusinessSeedOptions,
): Promise<SyntheticScenarioRunResult> {
  const existingId = await findSyntheticNamespaceClientId(services.pool, scenario.key);
  if (existingId) {
    const complete = await isSyntheticScenarioComplete(services.pool, scenario);
    if (complete) {
      return { key: scenario.key, outcome: 'already_present' };
    }
    await compensateSyntheticScenario(services.pool, scenario.key);
  }

  if (scenario.flow.kind === 'vertical') {
    const externalRef = syntheticExternalRef(scenario.key);
    const uatScenario = getUatScenario(scenario.flow.uatScenarioId);
    const fictional = buildDeterministicSyntheticClient(
      scenario.displayLabel,
      scenario.key,
      scenario.cnpjIndex,
    );
    const suffix = scenario.key.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
    const result = await runUatVerticalScenario(services, uatScenario, actor, unitId, {
      stopAfter: scenario.flow.stopAfter ?? 'complete',
      deterministicSuffix: suffix,
      syntheticClient: fictional,
      poNumberOverride: syntheticPoNumber(scenario.key),
      clientExternalErpId: externalRef,
      vehiclePlateScenarioIndex: scenario.cnpjIndex,
    });
    if (result.status === 'FAIL') {
      return { key: scenario.key, outcome: 'failed', error: result.error ?? 'vertical scenario failed' };
    }
    return { key: scenario.key, outcome: 'created' };
  }

  return runPartialFlow(services, actor, unitId, scenario, referenceDate, options);
}

async function compensateScenarioOnFailure(client: DbClient, scenarioKey: string): Promise<void> {
  try {
    await compensateSyntheticScenario(client, scenarioKey);
  } catch (compensationError) {
    const message =
      compensationError instanceof Error ? compensationError.message : String(compensationError);
    throw new Error(`SYNTHETIC_SEED_COMPENSATION_FAILED:${scenarioKey}:${message}`);
  }
}

export async function runSyntheticBusinessSeed(
  pool: Pool,
  actor: UatActor,
  services: UatVerticalServices,
  options: SyntheticBusinessSeedOptions = {},
): Promise<SyntheticBusinessSeedResult> {
  assertSyntheticBusinessSeedAllowed('SYNTHETIC_BUSINESS_SEED');
  const unitId = options.unitId ?? SYNTHETIC_SEED_UNIT_ID;
  const referenceDate = resolveSeedReferenceDate();
  const scenarios = options.scenarios ?? SYNTHETIC_BUSINESS_SCENARIOS;
  const scenarioResults: SyntheticScenarioRunResult[] = [];

  await ensureCatalogBaselineActor(pool);
  await ensureCisneServicePortfolioBaseline(pool);

  await withSyntheticSeedLock(pool, async (client) => {
    for (const scenario of scenarios) {
      if (options.failAfterScenarioKey === scenario.key) {
        throw new Error(`SYNTHETIC_SEED_INJECTED_FAILURE:${scenario.key}`);
      }
      try {
        const result = await runScenario(services, actor, unitId, scenario, referenceDate, options);
        scenarioResults.push(result);
        if (result.outcome === 'failed') {
          throw new Error(result.error ?? `Scenario ${scenario.key} failed`);
        }
      } catch (error) {
        const original = formatSeedError(error);
        try {
          await compensateScenarioOnFailure(client, scenario.key);
        } catch (compensationError) {
          const compensation =
            compensationError instanceof Error ? compensationError.message : String(compensationError);
          throw new Error(
            `SYNTHETIC_SEED_FAILED:${scenario.key}:${original}; compensation:${compensation}`,
          );
        }
        throw new Error(`SYNTHETIC_SEED_FAILED:${scenario.key}:${original}`);
      }
    }
  });

  const counts = await collectSyntheticCounts(pool);

  return {
    namespace: SYNTHETIC_SEED_NAMESPACE,
    unitId,
    referenceDateIso: referenceDate.toISOString(),
    scenarios: scenarioResults,
    counts,
  };
}

export async function cleanupSyntheticBusinessSeed(pool: Pool): Promise<{ before: SyntheticSeedCounts; after: SyntheticSeedCounts }> {
  assertSyntheticBusinessSeedAllowed('SYNTHETIC_SEED_CLEANUP');
  if (process.env['SYNTHETIC_SEED_CLEANUP_CONFIRM'] !== 'I_UNDERSTAND') {
    throw new Error('SYNTHETIC_SEED_CLEANUP_CONFIRM=I_UNDERSTAND is required for cleanup.');
  }

  return withSyntheticSeedLock(pool, async (client) => {
    const before = await collectSyntheticCounts(client);
    // Namespace-only cleanup: clients without operational children can be removed safely.
    await client.query(
      `DELETE FROM pty.clients c
       WHERE (c.external_erp_id LIKE $1 OR c.legal_name LIKE 'TESTE — %')
         AND NOT EXISTS (SELECT 1 FROM com.proposals p WHERE p.client_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM sr.service_requests r WHERE r.client_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM so.service_orders o WHERE o.client_id = c.id)`,
      [`${SYNTHETIC_SEED_NAMESPACE}:%`],
    );
    const after = await collectSyntheticCounts(client);
    return { before, after };
  });
}
