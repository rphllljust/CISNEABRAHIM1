import { expect } from 'vitest';
import type { Pool } from 'pg';
import type { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import type { ClientAccessService } from '../clients/services/client-access.service';
import type { ProposalsAccessService } from '../commercial/services/proposals-access.service';
import type { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import type { MasterBusinessArtifacts } from './master-business-types';
import type { UatActor, UatVerticalServices } from '../uat/uat-vertical-runner';

function parseMoney(value: string): bigint {
  const normalized = value.replace(/,/g, '').trim();
  const [whole = '0', fraction = ''] = normalized.split('.');
  const paddedFraction = (fraction + '0000').slice(0, 4);
  return BigInt(whole) * 10_000n + BigInt(paddedFraction);
}

export async function assertDomainInvariants(
  services: UatVerticalServices,
  actor: UatActor,
  artifacts: MasterBusinessArtifacts,
): Promise<void> {
  await assertHistoricalSnapshots(services, actor, artifacts);
  await assertPlanningAllocationExecutionSeparation(services, actor, artifacts);
  await assertMeasurementBillingIntegrity(services, actor, artifacts);
  await assertFinalizedDocumentImmutability(services, actor, artifacts);
}

async function assertHistoricalSnapshots(
  services: UatVerticalServices,
  actor: UatActor,
  artifacts: MasterBusinessArtifacts,
): Promise<void> {
  const historicalVersion = await services.catalogAccess.getVersion(
    actor,
    artifacts.serviceDefinitionId,
    artifacts.publishedVersionNumber,
  );
  expect(historicalVersion.code).toBe(artifacts.publishedServiceCode);
  expect(historicalVersion.status).toBe('PUBLISHED');

  const proposalVersion = await services.proposalsAccess.getVersion(
    actor,
    artifacts.proposalId,
    artifacts.proposalVersionNumber,
  );
  expect(proposalVersion.clientSnapshot?.['legalName']).toBe(artifacts.clientLegalNameAtCreate);
  expect(['ISSUED', 'ACCEPTED']).toContain(proposalVersion.status);

  const po = await services.purchaseOrdersAccess.getById(actor, artifacts.purchaseOrderId);
  expect(po.purchaseOrder.clientSnapshot?.legalName).toBe(artifacts.clientLegalNameAtCreate);
  expect(po.purchaseOrder.poNumber).toBe(artifacts.poNumber);
}

async function assertPlanningAllocationExecutionSeparation(
  services: UatVerticalServices,
  actor: UatActor,
  artifacts: MasterBusinessArtifacts,
): Promise<void> {
  const planned = await services.planningAccess.listPlannedResources(actor, artifacts.serviceOrderId);
  const allocations = await services.planningAccess.listAllocations(actor, artifacts.serviceOrderId);
  const execution = await services.executionAccess.getExecution(actor, artifacts.serviceOrderId);

  expect(planned.length).toBeGreaterThan(0);
  expect(allocations.length).toBeGreaterThan(0);
  expect(execution.entries.length).toBeGreaterThan(0);

  const plannedIds = new Set(planned.map((item) => item.id));
  const allocationPlannedIds = allocations
    .map((item) => item.plannedResourceId)
    .filter((id): id is string => id !== null);
  expect(allocationPlannedIds.every((id) => plannedIds.has(id))).toBe(true);

  const measurement = await services.measurementsAccess.getById(
    actor,
    artifacts.serviceOrderId,
    artifacts.measurementId,
  );
  /**
   * ORIGEM AUTORITATIVA DO ITEM DE MEDIÇÃO.
   *
   * Esta invariante exigia `sourceExecutionEntryId` — o vínculo com a tabela
   * INTERNA da execução. Depois da capability MEASUREMENT → ACCEPTANCE →
   * BILLING READINESS o item novo nasce da BASE PUBLICADA e NÃO tem esse vínculo.
   *
   * A invariante foi ATUALIZADA, não removida: o que ela protege é "todo item tem
   * procedência verificável". A procedência mudou de lugar — da entrada de
   * execução para a base publicada — e a asserção passou a afirmar a origem NOVA.
   * Removê-la deixaria um item sem procedência passar sem que nada reprovasse.
   */
  for (const item of measurement.items) {
    const hasBasisOrigin = item.sourceMeasurementBasisId !== null && item.sourceBasisLineKey !== null;
    const hasLegacyOrigin = item.sourceExecutionEntryId !== null;
    expect(hasBasisOrigin || hasLegacyOrigin).toBe(true);
    // As três verdades existem e são campos separados.
    expect(item.actualQuantity).toBeTruthy();
    expect(item.measuredQuantity).toBeTruthy();
  }
  // Ao menos um item veio da base: é o caminho autoritativo desta capability.
  expect(
    measurement.items.some((item) => item.sourceMeasurementBasisId !== null),
  ).toBe(true);

  expect(planned.some((item) => item.plannedQuantity !== null)).toBe(true);
  expect(allocations.some((item) => item.physicalAssetId !== null)).toBe(true);
  expect(execution.entries.some((entry) => entry.entryType === 'QUANTITY')).toBe(true);
  expect(measurement.items.length).toBeGreaterThan(0);

  const allocationIds = new Set(allocations.map((item) => item.id));
  expect(execution.entries.every((entry) => !allocationIds.has(entry.id))).toBe(true);
}

async function assertMeasurementBillingIntegrity(
  services: UatVerticalServices,
  actor: UatActor,
  artifacts: MasterBusinessArtifacts,
): Promise<void> {
  const measurement = await services.measurementsAccess.getById(
    actor,
    artifacts.serviceOrderId,
    artifacts.measurementId,
  );
  expect(measurement.status).toBe('APPROVED');

  const billing = await services.billingAccess.getById(actor, artifacts.serviceOrderId, artifacts.billingRecordId);
  expect(billing.items.length).toBeGreaterThan(0);
  expect(billing.items.length).toBeLessThanOrEqual(measurement.items.length);

  const measurementItemIds = new Set(measurement.items.map((item) => item.id));
  for (const billingItem of billing.items) {
    if (billingItem.measurementItemId === null) {
      continue;
    }
    expect(measurementItemIds.has(billingItem.measurementItemId)).toBe(true);
  }

  const notaFatura = await services.billingDocumentAccess.getById(
    actor,
    artifacts.serviceOrderId,
    artifacts.billingRecordId,
    artifacts.billingDocumentId,
  );
  expect(notaFatura.clientLegalNameSnapshot).toBe(artifacts.clientLegalNameAtCreate);
  expect(notaFatura.purchaseOrderNumberSnapshot).toBe(artifacts.poNumber);
  expect(parseMoney(notaFatura.totalAmount)).toBe(parseMoney(billing.totalAmount));
}

async function assertFinalizedDocumentImmutability(
  services: UatVerticalServices,
  actor: UatActor,
  artifacts: MasterBusinessArtifacts,
): Promise<void> {
  const first = await services.billingDocumentAccess.getById(
    actor,
    artifacts.serviceOrderId,
    artifacts.billingRecordId,
    artifacts.billingDocumentId,
  );
  const second = await services.billingDocumentAccess.getById(
    actor,
    artifacts.serviceOrderId,
    artifacts.billingRecordId,
    artifacts.billingDocumentId,
  );
  expect(second.artifactSha256).toBe(first.artifactSha256);
  expect(second.status).toBe('FINALIZED');
}

export async function assertCatalogHistoricalAfterUpdate(
  catalogAccess: ServiceCatalogAccessService,
  actor: UatActor,
  serviceDefinitionId: string,
  versionNumber: number,
  expectedCode: string,
): Promise<void> {
  const historicalVersion = await catalogAccess.getVersion(
    actor,
    serviceDefinitionId,
    versionNumber,
  );
  const version2 = await catalogAccess.createVersion(actor, serviceDefinitionId, {
    sourceVersion: versionNumber,
    name: 'Updated synthetic service',
    categoryId: historicalVersion.categoryId,
    archetype: 'RENTAL',
    measurementMode: 'BY_PERIOD',
    measurementBasis: 'TIME',
    allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
    pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '9999.0000', internalCost: '1.0000' }],
    resourceRequirements: [],
    laborRequirements: [],
    executionRequirements: [{ requirementType: 'OBSERVATION', requirementLevel: 'REQUIRED' }],
  });
  const definitionAfter = await catalogAccess.getDefinition(actor, serviceDefinitionId);
  await catalogAccess.publishVersion(actor, serviceDefinitionId, version2.version, definitionAfter.version);

  const historical = await catalogAccess.getVersion(actor, serviceDefinitionId, versionNumber);
  expect(historical.code).toBe(expectedCode);
  expect(historical.pricingModels[0]?.salePrice).not.toBe('9999.0000');
}

export async function assertPoHistoricalAfterClientUpdate(
  pool: Pool,
  clientAccess: ClientAccessService,
  purchaseOrdersAccess: PurchaseOrdersAccessService,
  actor: UatActor,
  artifacts: MasterBusinessArtifacts,
): Promise<void> {
  await clientAccess.update(actor, artifacts.clientId, {
    version: (await clientAccess.getById(actor, artifacts.clientId)).version,
    legalName: `Renamed Client ${artifacts.runSuffix}`,
    tradeName: 'RENAMED',
  });

  const po = await purchaseOrdersAccess.getById(actor, artifacts.purchaseOrderId);
  expect(po.purchaseOrder.clientSnapshot?.legalName).toBe(artifacts.clientLegalNameAtCreate);

  const row = await pool.query<{ legal_name: string }>(`SELECT legal_name FROM pty.clients WHERE id = $1`, [
    artifacts.clientId,
  ]);
  expect(row.rows[0]?.legal_name).toContain('Renamed Client');
}

export async function assertProposalIssuedNotOverwritten(
  proposalsAccess: ProposalsAccessService,
  actor: UatActor,
  artifacts: MasterBusinessArtifacts,
): Promise<void> {
  const issued = await proposalsAccess.getVersion(actor, artifacts.proposalId, artifacts.proposalVersionNumber);
  expect(['ISSUED', 'ACCEPTED']).toContain(issued.status);
  expect(issued.clientSnapshot?.['legalName']).toBe(artifacts.clientLegalNameAtCreate);
  expect(issued.globalSalePrice).toMatch(/^7500/);
}
