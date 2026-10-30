import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertCatalogCategory,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialProposalTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ScopeContextRepository } from '../authorization/repositories/scope-context.repository';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { CatalogModule } from '../catalog/catalog.module';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { ClientsModule } from '../clients/clients.module';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MEASUREMENT_STATUSES } from '../measurements/domain/measurement';
import { MEASUREMENTS_ERROR_CODES } from '../measurements/errors/measurements-error-codes';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { MeasurementsCapabilityService } from '../measurements/application/measurements-capability.service';
import { ResourcesModule } from '../resources/resources.module';
import { PLANNED_RESOURCE_KINDS } from '../service-orders/domain/resource-planning';
import { SERVICE_ORDER_ORIGINS } from '../service-orders/domain/service-order';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceOrderExecutionAccessService } from '../service-orders/services/service-order-execution-access.service';
import { ServiceOrderPlanningAccessService } from '../service-orders/services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';
import { OperationsService } from '../service-orders/services/operations.service';
import { WorkInboxService } from '../work-inbox/services/work-inbox.service';
import { MeasurementsWorkSource } from '../work-inbox/sources/measurements.source';

/**
 * MEDIÇÃO → ACEITE → FATURAMENTO — PROVA DE INTEGRAÇÃO DA CAPABILITY.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO PROVA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A cadeia completa, contra Postgres real:
 *
 *   MEASUREMENT_BASIS_READY
 *     → medição criada da BASE (não de execution_entries)
 *     → PLANEJADO / REALIZADO / MEDIDO em colunas separadas
 *     → variação detectada com severidade e decisão exigida
 *     → ajuste autorizado libera a aprovação
 *     → submit → review → approve
 *     → aceite do cliente registrado (política aplicada)
 *     → elegibilidade REAVALIADA na mesma transação
 *     → READY_TO_BILL
 *
 * E OS CAMINHOS NEGATIVOS:
 *
 *   aceite quando a política não exige  → recusado
 *   rejeição sem motivo                → recusado
 *   segunda decisão no mesmo ciclo     → recusado
 *   aceite sem permissão própria       → recusado
 *   versão esperada divergente         → conflito
 *   idempotência                       → um único efeito
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A TABELA É LIMPA COMO A DE MEDIÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `truncateServiceOrderTables` já cobre `so.*`, e as tabelas novas apontam para
 * `so.service_orders` por FK RESTRICT — o mesmo motivo pelo qual o helper já
 * conhece 37 tabelas. As quatro tabelas de `msr` desta capability entram no
 * helper na mesma mudança, senão a FK quebraria o `beforeEach` de suites alheias.
 */
const UNIT_A = 'unit-msr-cap-a';

/**
 * CNPJ ÚNICO POR CLIENTE.
 *
 * `CLIENT_ERROR_CODES.TAX_ID_CONFLICT` barra dois clientes com o mesmo documento
 * — corretamente, porque o mesmo CNPJ é a mesma pessoa jurídica. Um CNPJ fixo no
 * seed fazia a SEGUNDA ordem do mesmo teste falhar por conflito de CADASTRO, não
 * por defeito da capability. Aconteceu no teste da lacuna, que cria duas ordens.
 *
 * Os dígitos verificadores não são calculados porque o cadastro de teste não os
 * valida — o que se prova aqui é a UNICIDADE, não a elegibilidade fiscal.
 */
function generateTaxId(): string {
  // CNPJ tem 14 dígitos. `9` fixo na frente evita o caso de dígitos todos iguais,
  // que `isValidCnpjFormat` recusa. O comprimento é o que faltava: 1 + 11 + 1 = 13
  // dígitos fazia `TAX_ID_INVALID` reprovar TODO cadastro.
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  return `9${digits}0`;
}

const SAMPLE_RESOURCE_REQUIREMENTS = [
  {
    resourceTypeCode: 'WATER_TRUCK',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 1,
    sortOrder: 0,
  },
];

const SAMPLE_LABOR_REQUIREMENTS = [
  {
    laborTypeCode: 'DRIVER',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 1,
    sortOrder: 0,
  },
];

const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
  { requirementType: 'QUANTITY' as const, requirementLevel: 'REQUIRED' as const },
];

async function grantCapabilityActions(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRead,
    AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead,
    AUTHZ_ACTIONS.ServiceOrdersResourceAllocate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderDispatch,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
    AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    AUTHZ_ACTIONS.MeasurementsMeasurementCreate,
    AUTHZ_ACTIONS.MeasurementsMeasurementRead,
    AUTHZ_ACTIONS.MeasurementsMeasurementUpdate,
    AUTHZ_ACTIONS.MeasurementsMeasurementSubmit,
    AUTHZ_ACTIONS.MeasurementsMeasurementReview,
    AUTHZ_ACTIONS.MeasurementsMeasurementApprove,
    AUTHZ_ACTIONS.MeasurementsMeasurementReject,
    AUTHZ_ACTIONS.MeasurementsMeasurementAccept,
    /**
     * PREPARAR FATURAMENTO — a ação que atravessa a fronteira desta capability.
     *
     * Sem ela, o comando `PREPARE_BILLING` publica `NOT_AUTHORIZED` e o ator não
     * consegue ver que a cadeia chegou a `READY_TO_BILL` — o teste da cadeia
     * falharia por PERMISSÃO, não por fluxo.
     */
    AUTHZ_ACTIONS.BillingBillingRecordPrepare,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
  ];

  for (const action of actions) {
    const resourceType = action.startsWith('client:')
      ? AUTHZ_RESOURCE_TYPES.Client
      : action.startsWith('catalog:')
        ? AUTHZ_RESOURCE_TYPES.CatalogService
        : AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;

    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

function normalizeDecimal(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : value;
}

describe('Measurement → Acceptance → Billing readiness (PostgreSQL integration)', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let planningAccess: ServiceOrderPlanningAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let operationsService: OperationsService;
  let measurementsAccess: MeasurementsAccessService;
  let capability: MeasurementsCapabilityService;
  let measurementWorkSource: MeasurementsWorkSource;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for capability integration tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-test';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        AuthModule,
        AuditModule,
        AuthorizationModule,
        ClientsModule,
        CatalogModule,
        ResourcesModule,
        ServiceOrdersModule,
        MeasurementsModule,
      ],
    }).compile();

    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    planningAccess = module.get(ServiceOrderPlanningAccessService);
    executionAccess = module.get(ServiceOrderExecutionAccessService);
    operationsService = module.get(OperationsService);
    measurementsAccess = module.get(MeasurementsAccessService);
    capability = module.get(MeasurementsCapabilityService);
    measurementWorkSource = new MeasurementsWorkSource(
      capability,
      measurementsAccess,
      module.get(ScopeContextRepository),
    );
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateDocumentTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`cap-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantCapabilityActions(pool, identityId, identityId);
    return { identityId, sessionId: 'sid', login };
  }

  /** Ordem concluída com a BASE publicada pelo fechamento real da execução. */
  async function seedOrderWithBasis(options: {
    actor: { identityId: string; sessionId: string };
    plannedQuantity?: string;
    contractSnapshot?: Record<string, unknown>;
    serviceSnapshotExtra?: Record<string, unknown>;
  }) {
    const actor = options.actor;
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Cap ${crypto.randomUUID()}`,
      tradeName: 'Cliente Cap',
      taxId: generateTaxId(),
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAP-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess
      .create(actor, {
      code: `CAP-SRV-${suffix}`,
      name: 'Serviço medido',
      categoryId: category.categoryId,
      archetype: 'CIVIL_WORK',
      measurementMode: 'BY_QUANTITY',
      measurementBasis: 'VOLUME',
      /**
       * AS UNIDADES DO SERVIÇO COBREM TODO REALIZADO DA BASE.
       *
       * A base publicada agrega o realizado POR UNIDADE de medida: com um
       * caminhão e um condutor escalados, ela traz M3 (equipamento) e H`n       * (mão de obra). O domínio recusa unidade fora do serviço — corretamente,
       * porque medir em unidade que o contrato não previu não é medível.
       *
       * Antes desta capability a mesma lacuna existia e passava: os itens vinham
       * de execution_entries, que só registrava a quantidade em M3. Lendo a
       * base REAL, o serviço precisa declarar as duas unidades — e é isso que o
       * catálogo faz aqui.
       */
      allowedUnits: [
        { unitCode: 'M3', isDefault: true, sortOrder: 0 },
        { unitCode: 'HOUR', isDefault: false, sortOrder: 1 },
      ],
      /**
       * UM MODELO DE PREÇO POR CÓDIGO — a UNIQUE do catálogo é por código, não por
       * unidade. Dois `PER_UNIT` (um por unidade) violariam
       * `service_pricing_models_version_model_uidx`, e a criação do serviço seria
       * recusada com `DUPLICATE_PRICING_MODEL` — correto: o preço por unidade é
       * resolvido pela UNIDADE da linha, não por um segundo modelo.
       */
      pricingModels: [
        { unitCode: 'M3', modelCode: 'PER_M3', salePrice: '500.0000', internalCost: '400.0000' },
        { unitCode: 'HOUR', modelCode: 'HOURLY', salePrice: '120.0000', internalCost: '90.0000' },
      ],
      resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
      laborRequirements: SAMPLE_LABOR_REQUIREMENTS,
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(
      actor,
      draft.serviceDefinitionId,
      1,
      definition.version,
    );

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      description: 'OS da capability',
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });

    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });

    /**
     * A SEQUÊNCIA OPERACIONAL REAL É: PLANEJAR → DESPACHAR → INICIAR → CAPTURAR.
     *
     * O DESPACHO vem ANTES do início, e não é um detalhe de teste: é o que
     * confirma recursos, janela e prontidão, e é ele que torna as alocações
     * ACTIVE. Sem despacho, `registerActual` recusa por falta de recurso
     * identificado — correto, porque um realizado sem recurso não é auditável.
     *
     * Inverter esta ordem faria o teste exercitar um caminho que a operação não
     * percorre, e o defeito apareceria em produção.
     */
    /**
     * RESERVA NOMINAL — o passo que torna a ordem DESPACHÁVEL.
     *
     * A prontidão de despacho exige alocação nominal por ativo e por pessoa: sem
     * ela, não há recurso confirmado, e o despacho é recusado corretamente. A
     * alocação usa os serviços REAIS de planejamento, com o ativo e o membro
     * criados pelo caminho do sistema.
     *
     * A janela operacional vem das datas dos próprios requisitos planejados pela
     * própria ordem: o teste não inventa horário.
     */
    const assetType = await pool.query<{ id: string }>(
      `SELECT id FROM cat.physical_resource_types WHERE code = 'WATER_TRUCK' LIMIT 1`,
    );
    const typeId = assetType.rows[0]?.id;
    if (!typeId) {
      throw new Error('WATER_TRUCK physical resource type missing');
    }
    const assetRow = await pool.query<{ id: string }>(
      `INSERT INTO ast.physical_assets
         (asset_code, physical_resource_type_id, name, unit_id, created_by_identity_id, updated_by_identity_id)
       VALUES ($1, $2, 'Caminhão pipa', $3, $4, $4)
       RETURNING id`,
      [`CAP-CAM-${crypto.randomUUID().slice(0, 8)}`, typeId, UNIT_A, actor.identityId],
    );
    const memberRow = await pool.query<{ id: string }>(
      `INSERT INTO wrk.workforce_members
         (member_code, legal_name, default_labor_type_code, status)
       VALUES ($1, 'Carlos Motorista', 'DRIVER', 'ACTIVE')
       RETURNING id`,
      [`CAP-DRV-${crypto.randomUUID().slice(0, 8)}`],
    );

    const plannedPhysical = await pool.query<{ id: string }>(
      `SELECT id FROM so.planned_resources
        WHERE service_order_id = $1 AND requirement_kind = 'PHYSICAL_RESOURCE'
        ORDER BY created_at ASC LIMIT 1`,
      [released.id],
    );
    const plannedLabor = await pool.query<{ id: string }>(
      `SELECT id FROM so.planned_resources
        WHERE service_order_id = $1 AND requirement_kind = 'LABOR'
        ORDER BY created_at ASC LIMIT 1`,
      [released.id],
    );
    if (!plannedPhysical.rows[0] || !plannedLabor.rows[0]) {
      throw new Error('planejamento incompleto para alocação');
    }

    // A janela operacional cobre o dia corrente; a ordem é sintética e não tem
    // prazo contratual declarado.
    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + 8 * 60 * 60 * 1000);

    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: plannedPhysical.rows[0].id,
      physicalAssetId: assetRow.rows[0]!.id,
      operationalStart: windowStart.toISOString(),
      operationalEnd: windowEnd.toISOString(),
    });
    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: plannedLabor.rows[0].id,
      workforceMemberId: memberRow.rows[0]!.id,
      operationalStart: windowStart.toISOString(),
      operationalEnd: windowEnd.toISOString(),
    });

    const dispatched = await operationsService.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });

    const started = await executionAccess.start(actor, released.id, {
      rowVersion: dispatched.identity.rowVersion,
    });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Execução concluída.',
    });
    const afterObservation = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '12.5',
      unitCode: 'M3',
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────
     * O REALIZADO DIMENSIONADO É O QUE A BASE PUBLICA
     * ─────────────────────────────────────────────────────────────────────────
     *
     * `recordQuantity` grava em `so.execution_entries` — a ENTRADA OPERACIONAL,
     * consumida pelo gate de conclusão. A BASE de medição, porém, agrega
     * `so.execution_actuals` (o REALIZADO por recurso e unidade), porque é ele
     * que carrega `unit_of_measure` e o valor planejado de referência.
     *
     * Sem um realizado, o fechamento publica `lines: []` e a medição recusa com
     * `MEASUREMENT_BASIS_EMPTY` — o comportamento CORRETO: uma base sem realizado
     * produziria medição vazia e o faturamento falharia depois, longe da causa.
     *
     * O realizados são registrados pelo CAMINHO DO OPERADOR
     * (`registerActual`), não por INSERT direto: o teste prova o fluxo real.
     * `PLANNED_RESOURCE` veio do planejamento (1 caminhão + 1 condutor), então os
     * recursos são resolvidos das alocações criadas no despacho/execução.
     */
    const afterQuantity = await serviceOrdersAccess.getById(actor, started.id);

    // As alocações ficaram ACTIVE no DESPACHO — é de lá que o realizado resolve
    // o recurso. Conferir aqui transforma "despacho não ativou alocação" numa
    // falha explícita, em vez de um `ACTUAL_RESOURCE_REQUIRED` confuso adiante.
    const activeAllocations = await planningAccess.listAllocations(actor, started.id);
    const activeAsset = activeAllocations.find(
      (row) => row.physicalAssetId !== null && row.status === 'ACTIVE',
    );
    const activeMember = activeAllocations.find(
      (row) => row.workforceMemberId !== null && row.status === 'ACTIVE',
    );
    // O id é afirmado UMA vez e reusado: sem isso o teste repete ! em cada
    // chamada, e uma mudança de forma faria os três pontos falharem por motivos
    // diferentes.
    const assetId = activeAsset?.physicalAssetId;
    /**
     * ESTREITAMENTO EXPLÍCITO, NÃO ASSERÇÃO NÃO-NULA.
     *
     * `expect(assetId).toBeTruthy()` informa o TESTE, não o COMPILADOR: cada uso
     * seguinte precisaria de `!`, e o teste passaria a repetir a afirmação em
     * três pontos. Um `throw` aqui estreita o tipo de uma vez e transforma a
     * ausência da alocação numa falha com motivo declarado.
     */
    if (!assetId) {
      throw new Error('alocação ativa sem ativo físico após o despacho');
    }
    expect(activeMember?.workforceMemberId).toBeTruthy();

    let rowVersion = afterQuantity.rowVersion;

    const registered = await operationsService.registerActual(actor, started.id, {
      actualKind: 'EQUIPMENT_HOURS',
      physicalAssetId: assetId,
      workforceMemberId: null,
      actualValue: '12.5',
      unitOfMeasure: 'M3',
      rowVersion,
      idempotencyKey: `actual-m3-${crypto.randomUUID()}`,
    });
    rowVersion = registered.identity.rowVersion!;

    const labor = await operationsService.registerActual(actor, started.id, {
      actualKind: 'LABOR_HOURS',
      physicalAssetId: null,
      workforceMemberId: activeMember!.workforceMemberId,
      actualValue: '4',
      unitOfMeasure: 'HOUR',
      rowVersion,
      idempotencyKey: `actual-h-${crypto.randomUUID()}`,
    });
    rowVersion = labor.identity.rowVersion!;

    /**
     * O GATE DE CONCLUSÃO EXIGE O REALIZADO DE UM VEÍCULO ESCALADO.
     *
     * Com caminhão pipa alocado, a conclusão exige odômetro final, combustível
     * real e assinatura do cliente — a correção da vertical anterior, que
     * concluía sem eles. Registrá-los pelo caminho do OPERADOR é o que qualquer
     * execução real faz; omiti-los faria este teste provar uma conclusão que o
     * sistema recusa.
     *
     * A LEITURA INICIAL vem ANTES da final porque a monotonicidade do banco
     * compara contra a maior leitura anterior: sem abertura, a final é a
     * referência e não há regressão a detectar.
     */
    const meterOpen = await operationsService.registerMeter(actor, started.id, {
      physicalAssetId: assetId,
      meterKind: 'ODOMETER',
      readingValue: '125000',
      unitOfMeasure: 'KM',
      isInitial: true,
      rowVersion,
      idempotencyKey: `meter-open-${crypto.randomUUID()}`,
    });
    rowVersion = meterOpen.identity.rowVersion!;

    const meterClose = await operationsService.registerMeter(actor, started.id, {
      physicalAssetId: assetId,
      meterKind: 'ODOMETER',
      readingValue: '125120',
      unitOfMeasure: 'KM',
      isFinal: true,
      rowVersion,
      idempotencyKey: `meter-close-${crypto.randomUUID()}`,
    });
    rowVersion = meterClose.identity.rowVersion!;

    const fuel = await operationsService.registerFuel(actor, started.id, {
      physicalAssetId: assetId,
      volumeLiters: '120',
      odometerReading: '125120',
      rowVersion,
      idempotencyKey: `fuel-${crypto.randomUUID()}`,
    });
    rowVersion = fuel.identity.rowVersion!;

    const signature = await operationsService.registerSignature(actor, started.id, {
      signerName: 'João da Silva',
      signerRole: 'Responsável do cliente',
      signatureKind: 'CUSTOMER',
      rowVersion,
      idempotencyKey: `signature-${crypto.randomUUID()}`,
    });
    rowVersion = signature.identity.rowVersion!;

    const completed = await executionAccess.complete(actor, started.id, {
      rowVersion,
    });
    // A base publicada recebe a referência de PLANEJADO que o cenário declara. A
    // quantidade executada NÃO é reescrita: ela vem do fechamento real.
    /**
     * A LINHA DA BASE RECEBE A REFERÊNCIA DE PLANEJADO.
     *
     * O fechamento publica `plannedQuantity` a partir de `execution_actuals`, e
     * nesta OS sintética nenhum realizado trouxe valor planejado — a linha sai
     * com `plannedQuantity: null`. O cenário declara a referência que ele quer
     * comparar, e NÃO toca na quantidade realizada: reescrevê-la faria o teste
     * provar uma base que o sistema não produz.
     *
     * `jsonb_set` com `create_if_missing` é necessário porque a chave pode não
     * existir na linha publicada; sem o quarto argumento, o PostgreSQL devolve a
     * linha INALTERADA e o teste falharia com uma base vazia de planejado — foi
     * exatamente o sintoma observado (`MEASUREMENTS_BASIS_EMPTY` quando a linha
     * inteira era substituída por um valor parcial).
     */
    const basis = await pool.query<{ id: string; lines: unknown }>(
      `SELECT id, lines FROM so.measurement_basis WHERE service_order_id = $1 AND status = 'READY'`,
      [completed.id],
    );
    expect(basis.rows[0]).toBeTruthy();
    const currentLines = basis.rows[0]!.lines as Array<Record<string, unknown>>;
    /**
     * A BASE PRECISA TER LINHA.
     *
     * Uma base sem linha significa que o fechamento não publicou realizado — e
     * aí a falha é da vertical ANTERIOR, não deste cenário. Afirmar aqui faz o
     * defeito aparecer onde ele nasce, em vez de virar um `BASIS_EMPTY` genérico
     * mais adiante.
     */
    expect(Array.isArray(currentLines)).toBe(true);
    expect(currentLines.length).toBeGreaterThan(0);

    /**
     * SÓ A UNIDADE DO VOLUME RECEBE A REFERÊNCIA DE PLANEJADO.
     *
     * A primeira versão aplicava o planejado a TODAS as linhas, e o resultado foi
     * `HOUR` com planejado 10 (herdado de `M3`) e realizado 4 — uma variação
     * inventada pelo TESTE, não pelo sistema. O planejado é por UNIDADE; aplicá-lo
     * globalmente fabrica uma divergência que não existe na operação.
     */
    /**
     * A REFERÊNCIA DE PLANEJADO COBRE AS DUAS UNIDADES DO REALIZADO.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * POR QUE A REFERÊNCIA PRECISA EXISTIR PARA `HOUR` TAMBÉM
     * ─────────────────────────────────────────────────────────────────────────
     *
     * Sem planejado, o motor de variação compara contra ZERO e o desvio
     * percentual fica `null` — o que é honesto, mas produz severidade LOW... e
     * ainda assim uma LINHA de variação. Os cenários desta suíte querem provar a
     * cadeia de ACEITE e FATURAMENTO, não a variação; deixar a linha `HOUR`
     * divergente faria a elegibilidade parar em `BLOCKED` por um motivo que não é
     * o do teste.
     *
     * O cenário declara a referência de planejado de cada unidade — o que uma
     * ordem real tem, vinda de `so.planned_resources`. Assim a variação é ZERO
     * nas duas dimensões e a cadeia avança.
     */
    const plannedByUnit: Record<string, string> = { M3: options.plannedQuantity ?? '10', HOUR: '4' };
    const updatedLines = currentLines.map((line) => {
      const rawUnit = line['unitCode'];
      const unit = typeof rawUnit === 'string' ? rawUnit : '';
      return {
        ...line,
        plannedQuantity: plannedByUnit[unit] ?? line['plannedQuantity'] ?? null,
      };
    });
    await pool.query(`UPDATE so.measurement_basis SET lines = $2::jsonb WHERE id = $1`, [
      basis.rows[0]!.id,
      JSON.stringify(updatedLines),
    ]);

    if (options.contractSnapshot) {
      await pool.query(
        `UPDATE so.service_orders SET contract_snapshot = $2::jsonb, contract_reference = 'CTR-CAP-001'
          WHERE id = $1`,
        [completed.id, JSON.stringify(options.contractSnapshot)],
      );
    }
    if (options.serviceSnapshotExtra) {
      await pool.query(
        `UPDATE so.service_orders
            SET service_snapshot = service_snapshot || $2::jsonb
          WHERE id = $1`,
        [completed.id, JSON.stringify(options.serviceSnapshotExtra)],
      );
    }

    return { completed, client };
  }

  async function createDraftMeasurement(actor: { identityId: string; sessionId: string }) {
    const seeded = await seedOrderWithBasis({ actor });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    return { ...seeded, measurement };
  }

  async function approveMeasurement(
    actor: { identityId: string; sessionId: string },
    serviceOrderId: string,
    measurementId: string,
  ) {
    const current = await measurementsAccess.getById(actor, serviceOrderId, measurementId);
    const submitted = await measurementsAccess.submit(actor, serviceOrderId, measurementId, {
      rowVersion: current.rowVersion,
    });
    const reviewed = await measurementsAccess.startReview(actor, serviceOrderId, measurementId, {
      rowVersion: submitted.rowVersion,
    });
    return measurementsAccess.approve(actor, serviceOrderId, measurementId, {
      rowVersion: reviewed.rowVersion,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKBENCH — o read model orientado à decisão
  // ═══════════════════════════════════════════════════════════════════════════

  it('exposes the workbench with three separate truths and basis lineage', async () => {
    const actor = await seedActor();
    const { completed, measurement } = await createDraftMeasurement(actor);

    const workbench = await capability.getWorkbench(actor, completed.id);

    // IDENTIDADE e BASE
    expect(workbench.identity.serviceOrderId).toBe(completed.id);
    expect(workbench.identity.measurementId).toBe(measurement.id);
    expect(workbench.measurementBasis.basisId).toBeTruthy();
    expect(workbench.measurementBasis.executionClosureId).toBeTruthy();
    expect(workbench.measurementBasis.lineCount).toBeGreaterThan(0);

    // TRÊS VERDADES, EM CAMPOS SEPARADOS
    expect(workbench.quantities.lines.length).toBeGreaterThan(0);
    const line = workbench.quantities.lines[0]!;
    expect(normalizeDecimal(line.planned)).toBe('10');
    expect(normalizeDecimal(line.actual)).toBe('12.5');
    expect(normalizeDecimal(line.measured)).toBe('12.5');
    // Planjeto ≠ realizado: as três colunas existem separadamente, nunca uma só.
    expect(line.planned).not.toBe(line.actual);

    // MULTI-STATUS: cinco eixos independentes, cada um com sua verdade.
    expect(workbench.statuses.execution).toBe('CLOSED');
    expect(workbench.statuses.measurement).toBe(MEASUREMENT_STATUSES.Draft);
    expect(workbench.statuses.acceptance).toBeDefined();
    expect(workbench.statuses.billingEligibility).toBeDefined();
    expect(workbench.statuses.billing).toBe('NOT_PREPARED');

    /**
     * VARIAÇÃO: 25% acima do planejado (12.5 vs 10) com tolerância padrão de 5%.
     *
     * 25 / 5 = 5× a tolerância, acima do limiar de 4× → CRITICAL. E a severidade
     * máxima do CONJUNTO é CRITICAL, não a da primeira linha: o motor escala por
     * exposição, e a linha `HOUR` (realizado 4 contra planejado ausente) também
     * produz variação. A asserção é sobre o CONJUNTO — é o que o operador vê.
     */
    expect(workbench.variances.length).toBeGreaterThan(0);
    const variance = workbench.variances[0]!;
    expect(variance.severity).toBe('CRITICAL');
    expect(variance.requiresDecision).toBe(true);
    // A linha M3 é a de maior desvio: 2.5 M3 × R$ 500 = R$ 1.250.
    const m3Variance = workbench.variances.find((item) => item.dimensionKey === 'M3');
    expect(m3Variance?.financialImpact).toBe('1250.0000');
    // A exposição total soma TODAS as variações que exigem decisão — M3 e HOUR.
    expect(workbench.varianceSummary.highestSeverity).toBe('CRITICAL');
    expect(workbench.varianceSummary.decisionRequiredCount).toBeGreaterThanOrEqual(1);
    expect(workbench.varianceSummary.approvalClearable).toBe(false);
    expect(Number(workbench.economics.financialVariance)).toBeGreaterThan(0);

    /**
     * COMANDOS DECIDIDOS PELO BACKEND — COM A PRECEDÊNCIA CORRETA.
     *
     * Em DRAFT o primeiro impedimento de SUBMIT é a VARIAÇÃO: submeter para uma
     * análise que já nasce bloqueada seria trabalho perdido. APPROVE está
     * barrado por ESTADO (`INVALID_STATE`), e é assim que deve ser — o estado
     * vem antes da variação porque sem estar em análise não há decisão a tomar.
     *
     * A asserção é sobre os DOIS: cada comando informa o motivo que o barra
     * AGORA, e a próxima ação é a que destrava o caminho.
     */
    const submitCommand = workbench.availableCommands.find((item) => item.code === 'SUBMIT');
    expect(submitCommand?.enabled).toBe(false);
    expect(submitCommand?.blockingReasons).toContain('VARIANCE_REQUIRES_AUTHORIZATION');
    expect(submitCommand?.nextAction).toBe('AUTHORIZE_ADJUSTMENT');

    const approveCommand = workbench.availableCommands.find((item) => item.code === 'APPROVE');
    expect(approveCommand?.enabled).toBe(false);
    expect(approveCommand?.blockingReasons).toContain('INVALID_STATE');

    expect(workbench.nextAction?.code).toBe('AUTHORIZE_ADJUSTMENT');

    // DOCUMENT FLOW e PROCESSO
    expect(workbench.documentFlow.some((step) => step.kind === 'MEASUREMENT_BASIS')).toBe(true);
    expect(workbench.processContext.health.currentStage).toBeTruthy();
    expect(workbench.freshness.authority).toBe('SERVER');
  });

  it('blocks submission while the variance exceeds tolerance and records the adjustment decision', async () => {
    const actor = await seedActor();
    const { completed, measurement } = await createDraftMeasurement(actor);
    const item = measurement.items[0]!;

    /**
     * ─────────────────────────────────────────────────────────────────────────
     * O AJUSTE É UMA DECISÃO COM CONSEQUÊNCIA NO ITEM
     * ─────────────────────────────────────────────────────────────────────────
     *
     * Cenário: planejado 10, realizado 12.5. O comercial reconhece 15 M3 — MAIS
     * do que o realizado, porque houve trabalho adicional autorizado em campo.
     *
     * Sem decisão, `updateItem` recusa por `MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED`:
     * o medido nunca excede o realizado sem autoridade que o sustente. Esse é o
     * controle que impede reconhecer comercialmente mais do que se executou.
     */
    const initial = await capability.getWorkbench(actor, completed.id);
    const initialSubmit = initial.availableCommands.find((c) => c.code === 'SUBMIT');
    expect(initialSubmit?.enabled).toBe(false);
    expect(initialSubmit?.blockingReasons).toContain('VARIANCE_REQUIRES_AUTHORIZATION');

    await expect(
      measurementsAccess.updateItem(actor, completed.id, measurement.id, item.id, {
        rowVersion: measurement.rowVersion,
        measuredQuantity: '15',
      }),
    ).rejects.toMatchObject({
      code: MEASUREMENTS_ERROR_CODES.MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED,
    });

    const adjusted = await measurementsAccess.authorizeAdjustment(
      actor,
      completed.id,
      measurement.id,
      {
        rowVersion: measurement.rowVersion,
        measurementItemId: item.id,
        adjustmentQuantity: '2.5',
        reason: 'Volume adicional autorizado pelo cliente em campo.',
      },
    );
    expect(adjusted.adjustments).toHaveLength(1);

    // Com a decisão registrada, o reconhecimento maior passa a ser aplicável.
    const updated = await measurementsAccess.updateItem(
      actor,
      completed.id,
      measurement.id,
      item.id,
      { rowVersion: adjusted.rowVersion, measuredQuantity: '15' },
    );
    expect(normalizeDecimal(updated.items[0]?.measuredQuantity)).toBe('15');

    /**
     * A VARIAÇÃO PASSA A TER DECISÃO — E O MOTIVO DO BLOQUEIO MUDA.
     *
     * Antes: `VARIANCE_REQUIRES_AUTHORIZATION` — ninguém havia decidido.
     * Depois: `VARIANCE_ADJUSTMENT_NOT_APPLIED` — a decisão existe e o item não a
     * reflete por inteiro.
     *
     * A distinção é OPERACIONAL, não cosmética: o primeiro motivo pede uma
     * DECISÃO; o segundo pede que se APLIQUE uma decisão que já existe. Um motivo
     * único faria o sistema pedir autorização duas vezes para o mesmo desvio.
     *
     * A variação NÃO desaparece ao ser decidida: ela é o desvio real entre plano e
     * execução, e escondê-lo depois da decisão apagaria a trilha do porquê o
     * número medido é maior que o planejado.
     */
    const workbenchAfter = await capability.getWorkbench(actor, completed.id);
    const adjustedVariance = workbenchAfter.variances.find((v) => v.dimensionKey === 'M3');
    expect(adjustedVariance).toBeDefined();
    expect(adjustedVariance!.blockingReason).toBe('VARIANCE_ADJUSTMENT_NOT_APPLIED');
    expect(adjustedVariance!.financialImpact).toBeTruthy();
    expect(workbenchAfter.varianceSummary.approvalClearable).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACEITE — a capability industrializada
  // ═══════════════════════════════════════════════════════════════════════════

  it('walks APPROVE → RECORD_ACCEPTANCE → READY_TO_BILL in one chain', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true, paymentTerms: '30 DDL' },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    const approved = await approveMeasurement(actor, seeded.completed.id, measurement.id);
    expect(approved.status).toBe(MEASUREMENT_STATUSES.Approved);

    // Antes do aceite: a elegibilidade está PENDING e o faturamento bloqueado.
    const beforeAcceptance = await capability.getWorkbench(actor, seeded.completed.id);
    expect(beforeAcceptance.acceptance.required).toBe(true);
    expect(beforeAcceptance.acceptance.state).toBe('PENDING');
    expect(beforeAcceptance.acceptance.blocksBilling).toBe(true);
    expect(beforeAcceptance.statuses.billingEligibility).toBe('PENDING');
    const prepareBefore = beforeAcceptance.availableCommands.find(
      (item) => item.code === 'PREPARE_BILLING',
    );
    expect(prepareBefore?.enabled).toBe(false);
    expect(prepareBefore?.blockingReasons).toContain('CUSTOMER_ACCEPTANCE_PENDING');

    // O COMANDO DE ACEITE.
    const afterAcceptance = await capability.recordAcceptance(
      actor,
      seeded.completed.id,
      measurement.id,
      {
        expectedVersion: approved.rowVersion,
        idempotencyKey: `accept-${crypto.randomUUID()}`,
        result: 'ACCEPTED',
        observation: 'Entrega conferida com o responsável do cliente.',
        customerSignerName: 'João da Silva',
      },
    );

    // ACEITE registrado e legível.
    expect(afterAcceptance.acceptance.state).toBe('ACCEPTED');
    expect(afterAcceptance.acceptance.blocksBilling).toBe(false);
    expect(afterAcceptance.acceptance.latest?.result).toBe('ACCEPTED');
    expect(afterAcceptance.acceptance.latest?.customerSignerName).toBe('João da Silva');
    expect(afterAcceptance.acceptance.history).toHaveLength(1);

    // ELEGIBILIDADE REAVALIADA NA MESMA TRANSAÇÃO → READY_TO_BILL.
    expect(afterAcceptance.billingEligibility.result).toBe('READY');
    expect(afterAcceptance.billingEligibility.blockingReasons).toEqual([]);
    expect(afterAcceptance.statuses.billingEligibility).toBe('READY');
    // O valor e o dos ITENS MEDIDOS, calculado pelo motor comercial - nao uma
    // soma feita no teste. O preco por unidade e resolvido pela unidade da linha.
    expect(Number(afterAcceptance.economics.grossValue)).toBeGreaterThan(0);
    expect(afterAcceptance.economics.currency).toBe('BRL');

    const prepareAfter = afterAcceptance.availableCommands.find(
      (item) => item.code === 'PREPARE_BILLING',
    );
    expect(prepareAfter?.enabled).toBe(true);
    expect(afterAcceptance.nextAction?.code).toBe('PREPARE_BILLING');

    // O FATO foi publicado na outbox, no MESMO commit do estado.
    const outbox = await pool.query<{ event_type: string }>(
      `SELECT event_type::text AS event_type FROM evt.outbox_events
        WHERE aggregate_id = $1 ORDER BY created_at ASC`,
      [measurement.id],
    );
    const eventTypes = outbox.rows.map((row) => row.event_type);
    expect(eventTypes).toContain('CUSTOMER_ACCEPTANCE_RECORDED');
    expect(eventTypes).toContain('BILLING_ELIGIBILITY_GRANTED');
  });

  it('records a rejection with a mandatory reason and keeps billing blocked', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    const approved = await approveMeasurement(actor, seeded.completed.id, measurement.id);

    const afterRejection = await capability.recordAcceptance(
      actor,
      seeded.completed.id,
      measurement.id,
      {
        expectedVersion: approved.rowVersion,
        idempotencyKey: `reject-${crypto.randomUUID()}`,
        result: 'REJECTED',
        observation: 'Entrega conferida em campo.',
        rejectionReason: 'Volume medido não confere com o aferido em campo.',
      },
    );

    expect(afterRejection.acceptance.state).toBe('REJECTED');
    expect(afterRejection.acceptance.blocksBilling).toBe(true);
    expect(afterRejection.acceptance.blockingReason).toBe('CUSTOMER_ACCEPTANCE_REJECTED');
    // A PENDÊNCIA carrega o MOTIVO, não a observação.
    expect(afterRejection.acceptance.latest?.rejectionReason).toContain('Volume medido');
    expect(afterRejection.acceptance.latest?.observation).toContain('Entrega conferida');

    expect(afterRejection.billingEligibility.result).toBe('BLOCKED');
    expect(afterRejection.billingEligibility.blockingReasons).toContain(
      'CUSTOMER_ACCEPTANCE_REJECTED',
    );
    // A próxima ação é corrigir e pedir novo aceite.
    expect(afterRejection.billingEligibility.nextAction?.code).toBe(
      'CORRECT_AND_REQUEST_ACCEPTANCE',
    );

    const outbox = await pool.query<{ event_type: string }>(
      `SELECT event_type::text AS event_type FROM evt.outbox_events WHERE aggregate_id = $1`,
      [measurement.id],
    );
    expect(outbox.rows.map((row) => row.event_type)).toContain('CUSTOMER_REJECTION_RECORDED');
  });

  it('refuses acceptance when the commercial policy does not require it', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      // Contrato declara EXPRESSAMENTE que não há aceite formal.
      contractSnapshot: { acceptanceRequired: false },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    const approved = await approveMeasurement(actor, seeded.completed.id, measurement.id);

    const workbench = await capability.getWorkbench(actor, seeded.completed.id);
    expect(workbench.acceptance.required).toBe(false);
    expect(workbench.acceptance.state).toBe('NOT_REQUIRED');
    expect(workbench.acceptance.policySource).toBe('CONTRACT');
    // A elegibilidade não é bloqueada por um aceite que ninguém contratou.
    expect(workbench.billingEligibility.result).toBe('READY');

    await expect(
      capability.recordAcceptance(actor, seeded.completed.id, measurement.id, {
        expectedVersion: approved.rowVersion,
        idempotencyKey: `no-policy-${crypto.randomUUID()}`,
        result: 'ACCEPTED',
        observation: 'Tentativa de aceite sem política que o exija.',
      }),
    ).rejects.toMatchObject({
      code: 'ACCEPTANCE_POLICY_NOT_APPLICABLE',
    });
  });

  it('refuses a second decision in the same cycle (one authoritative acceptance)', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    const approved = await approveMeasurement(actor, seeded.completed.id, measurement.id);

    const accepted = await capability.recordAcceptance(
      actor,
      seeded.completed.id,
      measurement.id,
      {
        expectedVersion: approved.rowVersion,
        idempotencyKey: `first-${crypto.randomUUID()}`,
        result: 'ACCEPTED',
        observation: 'Entrega conferida.',
      },
    );

    await expect(
      capability.recordAcceptance(actor, seeded.completed.id, measurement.id, {
        expectedVersion: accepted.identity.rowVersion!,
        idempotencyKey: `second-${crypto.randomUUID()}`,
        result: 'REJECTED',
        observation: 'Segunda decisão no mesmo ciclo.',
        rejectionReason: 'Tentativa de sobrescrever a decisão.',
      }),
    ).rejects.toMatchObject({
      code: 'ACCEPTANCE_ALREADY_RECORDED',
    });

    // A decisão original permanece — HISTORY LOSS 0.
    const workbench = await capability.getWorkbench(actor, seeded.completed.id);
    expect(workbench.acceptance.latest?.result).toBe('ACCEPTED');
    expect(workbench.acceptance.history).toHaveLength(1);
  });

  it('refuses acceptance with a stale expected version (concurrency)', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    const approved = await approveMeasurement(actor, seeded.completed.id, measurement.id);

    await expect(
      capability.recordAcceptance(actor, seeded.completed.id, measurement.id, {
        expectedVersion: approved.rowVersion + 99,
        idempotencyKey: `stale-${crypto.randomUUID()}`,
        result: 'ACCEPTED',
        observation: 'Versão desatualizada.',
      }),
    ).rejects.toMatchObject({ code: MEASUREMENTS_ERROR_CODES.VERSION_CONFLICT });
  });

  it('is idempotent: the same key produces ONE business effect', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    const approved = await approveMeasurement(actor, seeded.completed.id, measurement.id);
    const idempotencyKey = `idem-${crypto.randomUUID()}`;

    await capability.recordAcceptance(actor, seeded.completed.id, measurement.id, {
      expectedVersion: approved.rowVersion,
      idempotencyKey,
      result: 'ACCEPTED',
      observation: 'Primeira execução do comando.',
    });

    // O retry chega com a versão que o PRIMEIRO comando produziu — é o que um
    // cliente faria depois de um timeout de rede.
    const current = await measurementsAccess.getById(actor, seeded.completed.id, measurement.id);
    await capability.recordAcceptance(actor, seeded.completed.id, measurement.id, {
      expectedVersion: current.rowVersion,
      idempotencyKey,
      result: 'ACCEPTED',
      observation: 'Reenvio do mesmo comando.',
    });

    const acceptances = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM msr.customer_acceptances WHERE measurement_id = $1`,
      [measurement.id],
    );
    expect(acceptances.rows[0]!.count).toBe('1');
  });

  it('denies acceptance to an actor without the acceptance capability', async () => {
    const owner = await seedActor();
    const seeded = await seedOrderWithBasis({
      owner,
    } as never).catch(() => null);
    if (seeded) {
      return;
    }

    const actor = await seedActor();
    const seededOrder = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true },
    });
    const measurement = await measurementsAccess.create(actor, seededOrder.completed.id);
    const approved = await approveMeasurement(actor, seededOrder.completed.id, measurement.id);

    // Ator sem NENHUMA concessão de aceite — mas com leitura da ordem.
    const login = normalizeLoginIdentifier(`no-accept-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });

    await expect(
      capability.recordAcceptance(
        { identityId, sessionId: 'sid' },
        seededOrder.completed.id,
        measurement.id,
        {
          expectedVersion: approved.rowVersion,
          idempotencyKey: `deny-${crypto.randomUUID()}`,
          result: 'ACCEPTED',
          observation: 'Sem permissão.',
        },
      ),
    ).rejects.toMatchObject({ code: MEASUREMENTS_ERROR_CODES.DENIED });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REVENUE LEAKAGE — a projeção cross-stage
  // ═══════════════════════════════════════════════════════════════════════════

  it('projects revenue leakage by stage with a drill-down that rebuilds the total', async () => {
    const actor = await seedActor();

    // ORDEM 1: aprovada, aguardando aceite → APPROVED_NOT_ACCEPTED.
    const pending = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true },
    });
    const pendingMeasurement = await measurementsAccess.create(actor, pending.completed.id);
    await approveMeasurement(actor, pending.completed.id, pendingMeasurement.id);

    // ORDEM 2: somente executada, sem medição → EXECUTED_NOT_MEASURED.
    await seedOrderWithBasis({ actor, plannedQuantity: '12.5' });

    const leakage = await capability.getRevenueLeakage(actor, {
      unitId: UNIT_A,
      limit: 100,
    });

    expect(leakage.context.unitId).toBe(UNIT_A);
    // Todos os estágios são publicados, mesmo os vazios.
    expect(leakage.stages.length).toBeGreaterThan(0);

    const approvedNotAccepted = leakage.stages.find(
      (stage) => stage.stage === 'APPROVED_NOT_ACCEPTED',
    );
    expect(approvedNotAccepted?.count).toBeGreaterThanOrEqual(1);

    const executedNotMeasured = leakage.stages.find(
      (stage) => stage.stage === 'EXECUTED_NOT_MEASURED',
    );
    expect(executedNotMeasured?.count).toBeGreaterThanOrEqual(1);

    // O TOTAL é a soma das POSIÇÕES — o drill-down reconstrói o mesmo número.
    const sumOfPositions = leakage.positions
      .map((position) => Number(position.amount ?? 0))
      .reduce((sum, value) => sum + value, 0);
    expect(Number(leakage.total.amount ?? 0)).toBeCloseTo(sumOfPositions, 4);
    expect(leakage.total.count).toBe(leakage.positions.length);

    // Cada posição carrega DONO, IMPEDITIVO e PRÓXIMA AÇÃO — número sem
    // drill-down não tem valor.
    for (const position of leakage.positions) {
      expect(position.ownerRole.length).toBeGreaterThan(0);
      expect(position.nextAction.code.length).toBeGreaterThan(0);
      expect(position.orderNumber.length).toBeGreaterThan(0);
    }
  });

  it('MASTER 001-02: authenticated HTTP commands -> PostgreSQL -> Inbox -> KPI -> Billing eligibility', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true, paymentTerms: '30 DDL' },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    const inbox = new WorkInboxService([measurementWorkSource]);

    // The HTTP commands use the SAME Nest controllers/guards as production,
    // while the database is disposable TEST_DATABASE_URL only.
    const httpModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const httpApp = httpModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApiTestApp(httpApp);
    try {
      await httpApp.init();
      await httpApp.getHttpAdapter().getInstance().ready();
      const login = await httpApp.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'user-agent': `master-001-02-${crypto.randomUUID()}` },
        payload: { login: actor.login, password: AUTH_TEST_PASSWORD },
      });
      expect(login.statusCode).toBe(200);
      const headers = { authorization: `Bearer ${parseAuthTokenResponse(login.body).accessToken}` };
      const path = `/api/v1/service-orders/${seeded.completed.id}/measurements/${measurement.id}`;

      const submitResponse = await httpApp.inject({
        method: 'POST', url: `${path}/submit`, headers,
        payload: { rowVersion: measurement.rowVersion },
      });
      expect(submitResponse.statusCode).toBe(200);
      const submitted = JSON.parse(submitResponse.body) as { status: string; rowVersion: number };
      expect(submitted.status).toBe(MEASUREMENT_STATUSES.Submitted);

      const pendingApproval = await inbox.list(actor, { domain: 'OPERACOES', unitId: UNIT_A });
      expect(pendingApproval.unavailableDomains).toEqual([]);
      expect(pendingApproval.total).toBe(1);
      expect(pendingApproval.byDomain.OPERACOES).toBe(pendingApproval.total);
      expect(pendingApproval.items[0]?.id).toBe(`OPERACOES:MEASUREMENT:APPROVAL:${measurement.id}`);

      const reviewResponse = await httpApp.inject({
        method: 'POST', url: `${path}/start-review`, headers,
        payload: { rowVersion: submitted.rowVersion },
      });
      expect(reviewResponse.statusCode).toBe(200);
      const reviewed = JSON.parse(reviewResponse.body) as { rowVersion: number };

      const approveResponse = await httpApp.inject({
        method: 'POST', url: `${path}/approve`, headers,
        payload: { rowVersion: reviewed.rowVersion },
      });
      expect(approveResponse.statusCode).toBe(200);
      const approved = JSON.parse(approveResponse.body) as { status: string; rowVersion: number };
      expect(approved.status).toBe(MEASUREMENT_STATUSES.Approved);

      const afterApproval = await inbox.list(actor, { domain: 'OPERACOES', unitId: UNIT_A });
      expect(afterApproval.items.find((item) => item.id.includes(measurement.id))).toBeUndefined();

      const pendingAcceptance = await inbox.list(actor, { domain: 'COMERCIAL', unitId: UNIT_A });
      expect(pendingAcceptance.unavailableDomains).toEqual([]);
      expect(pendingAcceptance.total).toBe(1);
      expect(pendingAcceptance.byDomain.COMERCIAL).toBe(pendingAcceptance.total);
      expect(pendingAcceptance.items[0]?.id).toBe(`COMERCIAL:MEASUREMENT:ACCEPTANCE:${measurement.id}`);

      const idem = `master-001-02-${crypto.randomUUID()}`;
      const acceptanceResponse = await httpApp.inject({
        method: 'POST', url: `${path}/acceptance`, headers,
        payload: {
          expectedVersion: approved.rowVersion,
          idempotencyKey: idem,
          result: 'ACCEPTED',
          observation: 'Cliente conferiu e aceitou a entrega.',
          customerSignerName: 'Representante do cliente',
        },
      });
      expect(acceptanceResponse.statusCode).toBe(200);
      const accepted = JSON.parse(acceptanceResponse.body) as {
        acceptance: { state: string; history: unknown[] };
        billingEligibility: { result: string };
      };
      expect(accepted.acceptance.state).toBe('ACCEPTED');
      expect(accepted.acceptance.history).toHaveLength(1);
      expect(accepted.billingEligibility.result).toBe('READY');

      const retry = await httpApp.inject({
        method: 'POST', url: `${path}/acceptance`, headers,
        payload: {
          expectedVersion: approved.rowVersion,
          idempotencyKey: idem,
          result: 'ACCEPTED',
          observation: 'Cliente conferiu e aceitou a entrega.',
          customerSignerName: 'Representante do cliente',
        },
      });
      expect(retry.statusCode).toBe(200);
      expect((JSON.parse(retry.body) as { acceptance: { history: unknown[] } }).acceptance.history).toHaveLength(1);

      const cleared = await inbox.list(actor, { domain: 'COMERCIAL', unitId: UNIT_A });
      expect(cleared.unavailableDomains).toEqual([]);
      expect(cleared.total).toBe(0);
      expect(cleared.byDomain.COMERCIAL).toBe(0);

      const persisted = await measurementsAccess.getById(actor, seeded.completed.id, measurement.id);
      expect(persisted.status).toBe(MEASUREMENT_STATUSES.Approved);
      expect(persisted.historyEvents.map((event) => event.eventType)).toContain('APPROVED');
      const outbox = await pool.query<{ event_type: string }>(
        `SELECT event_type::text AS event_type FROM evt.outbox_events
         WHERE aggregate_id = $1`,
        [measurement.id],
      );
      expect(outbox.rows.map((row) => row.event_type)).toEqual(
        expect.arrayContaining(['CUSTOMER_ACCEPTANCE_RECORDED', 'BILLING_ELIGIBILITY_GRANTED']),
      );
    } finally {
      await httpApp.close();
    }
  });

  it('work queue derives from the same projection as the control tower', async () => {
    const actor = await seedActor();
    const seeded = await seedOrderWithBasis({
      actor,
      plannedQuantity: '12.5',
      contractSnapshot: { acceptanceRequired: true },
    });
    const measurement = await measurementsAccess.create(actor, seeded.completed.id);
    await approveMeasurement(actor, seeded.completed.id, measurement.id);

    const queue = await capability.getWorkQueue(actor, { unitId: UNIT_A, limit: 50 });
    const leakage = await capability.getRevenueLeakage(actor, { unitId: UNIT_A, limit: 50 });

    // A fila e o control tower NÃO mantêm classificações próprias: o conjunto de
    // ordens é o mesmo, e o estágio de cada uma coincide.
    const queueStages = new Map(queue.items.map((item) => [item.serviceOrderId, item.stage]));
    for (const position of leakage.positions) {
      expect(queueStages.get(position.serviceOrderId)).toBe(position.stage);
    }
    expect(queue.context.unitId).toBe(UNIT_A);
  });

  it('denies the work queue to an actor without unit scope', async () => {
    const actor = await seedActor();

    const login = normalizeLoginIdentifier(`no-unit-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.MeasurementsMeasurementRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: 'unit-outra',
      grantedByIdentityId: actor.identityId,
    });

    await expect(
      capability.getWorkQueue({ identityId, sessionId: 'sid' }, { unitId: UNIT_A, limit: 10 }),
    ).rejects.toMatchObject({ code: MEASUREMENTS_ERROR_CODES.DENIED });
  });
});