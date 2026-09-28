import { hashPassword, insertCatalogCategory, insertGrant, insertIdentity, syntheticVehiclePlate } from '@cisne/database';
import type { Pool } from 'pg';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import type { BillingAccessService } from '../billing/services/billing-access.service';
import { BILLING_DOCUMENT_STATUSES } from '../billing/domain/billing-document';
import type { BillingDocumentAccessService } from '../billing/services/billing-document-access.service';
import type { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import type { ClientAccessService } from '../clients/services/client-access.service';
import { ADDRESS_PURPOSES, CONTACT_PURPOSES } from '../clients/domain/client-status';
import {
  PROPOSAL_ACCEPTANCE_ORIGINS,
  PROPOSAL_PRICING_STRUCTURES,
} from '../commercial/domain/proposal';
import { PURCHASE_ORDER_PRICING_STRUCTURES } from '../commercial/domain/purchase-order';
import type { ProposalsAccessService } from '../commercial/services/proposals-access.service';
import type { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import { DOCUMENT_CATEGORIES } from '../documents/domain/document-categories';
import { minimalPdfBuffer } from '../documents/domain/file-validation';
import { assertNoStorageKeyLeak } from '../documents/serializers/documents-response.serializer';
import type { DocumentsAccessService } from '../documents/services/documents-access.service';
import { MEASUREMENT_STATUSES } from '../measurements/domain/measurement';
import type { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import {
  SERVICE_REQUEST_DOCUMENT_LINK_PURPOSES,
  SERVICE_REQUEST_ORIGINS,
  SERVICE_REQUEST_STATUSES,
} from '../requests/domain/service-request';
import type { ServiceRequestsAccessService } from '../requests/services/service-requests-access.service';
import type { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import type { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';
import { PLANNED_RESOURCE_KINDS } from '../service-orders/domain/resource-planning';
import type { ServiceOrderExecutionAccessService } from '../service-orders/services/service-order-execution-access.service';
import type { ServiceOrderPlanningAccessService } from '../service-orders/services/service-order-planning-access.service';
import type { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';
import { buildSyntheticUatClient } from '../master-business/synthetic-test-data';
import type { MasterBusinessArtifacts } from '../master-business/master-business-types';
import type { UatFictionalClient, UatScenarioDefinition } from './uat-scenarios';
import type { UatScenarioResult } from './uat-types';
import { grantsForProfile } from './uat-profiles';

export type UatActor = { identityId: string; sessionId: string };

export type UatVerticalServices = {
  pool: Pool;
  clientAccess: ClientAccessService;
  catalogAccess: ServiceCatalogAccessService;
  proposalsAccess: ProposalsAccessService;
  purchaseOrdersAccess: PurchaseOrdersAccessService;
  serviceRequestsAccess: ServiceRequestsAccessService;
  documentsAccess: DocumentsAccessService;
  serviceOrdersAccess: ServiceOrdersAccessService;
  planningAccess: ServiceOrderPlanningAccessService;
  executionAccess: ServiceOrderExecutionAccessService;
  measurementsAccess: MeasurementsAccessService;
  billingAccess: BillingAccessService;
  billingDocumentAccess: BillingDocumentAccessService;
  assetsAccess: PhysicalAssetsAccessService;
  resourceTypesAccess: PhysicalResourceTypesAccessService;
};

export function resolveResourceType(action: string): string {
  if (action.startsWith('platform:')) return AUTHZ_RESOURCE_TYPES.Platform;
  if (action.startsWith('client:')) return AUTHZ_RESOURCE_TYPES.Client;
  if (action.startsWith('supplier:')) return AUTHZ_RESOURCE_TYPES.Supplier;
  if (action.startsWith('people:')) return AUTHZ_RESOURCE_TYPES.PeoplePerson;
  if (action.startsWith('catalog:')) return AUTHZ_RESOURCE_TYPES.CatalogService;
  if (action.startsWith('commercial:proposal')) return AUTHZ_RESOURCE_TYPES.CommercialProposal;
  if (action.startsWith('commercial:purchase-order')) return AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder;
  if (action.startsWith('requests:')) return AUTHZ_RESOURCE_TYPES.RequestsServiceRequest;
  if (action.startsWith('documents:')) return AUTHZ_RESOURCE_TYPES.DocumentsDocument;
  if (action.startsWith('resources:asset')) return AUTHZ_RESOURCE_TYPES.ResourcesAsset;
  if (action.startsWith('resources:resource-type')) return AUTHZ_RESOURCE_TYPES.ResourcesResourceType;
  if (action.startsWith('resources:labor')) return AUTHZ_RESOURCE_TYPES.ResourcesLaborType;
  if (action.startsWith('billing:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  if (action.startsWith('measurements:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
}

export async function grantUatProfile(
  pool: Pool,
  identityId: string,
  grantedBy: string,
  profileId: Parameters<typeof grantsForProfile>[0],
): Promise<void> {
  for (const action of grantsForProfile(profileId)) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: resolveResourceType(action),
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

export async function runUatVerticalScenario(
  services: UatVerticalServices,
  scenario: UatScenarioDefinition,
  actor: UatActor,
  unitId: string,
  options?: {
    reviewer?: UatActor;
    stopAfter?: 'prepared' | 'released' | 'completed_execution' | 'measurement_approved' | 'complete';
    captureArtifacts?: boolean;
    deterministicSuffix?: string;
    syntheticClient?: UatFictionalClient;
    poNumberOverride?: string;
    clientExternalErpId?: string;
    vehiclePlateScenarioIndex?: number;
  },
): Promise<UatScenarioResult & { measurementId?: string; artifacts?: MasterBusinessArtifacts }> {
  const started = Date.now();
  let stage = 'bootstrap';
  try {
    const suffix =
      options?.deterministicSuffix ??
      crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const poNumber = options?.poNumberOverride ?? `PO-UAT-${scenario.id.toUpperCase()}-${suffix}`;
    const syntheticClient =
      options?.syntheticClient ?? buildSyntheticUatClient(scenario.id, suffix);
    const requestLocation =
      scenario.archetype === 'TRANSPORT'
        ? {
            origin: `${syntheticClient.city} - Centro de distribuição`,
            destination: 'Porto Velho - Cliente final',
          }
        : {
            city: syntheticClient.city,
          };
    const plannedOperationalWindow =
      scenario.archetype === 'RENTAL'
        ? {
            operationalStart: '2026-07-01T08:00:00.000Z',
            operationalEnd: '2026-07-04T18:00:00.000Z',
          }
        : {
            operationalStart: '2026-07-01T08:00:00.000Z',
            operationalEnd: '2026-07-01T18:00:00.000Z',
          };

    stage = 'client:create';
    const client = await services.clientAccess.create(actor, {
      legalName: syntheticClient.legalName,
      tradeName: syntheticClient.tradeName,
      taxId: syntheticClient.taxId,
      externalErpId: options?.clientExternalErpId,
      contacts: [
        {
          name: syntheticClient.contactName,
          purpose: CONTACT_PURPOSES.Operational,
          phone: '69999990000',
        },
      ],
      addresses: [
        {
          purpose: ADDRESS_PURPOSES.Billing,
          street: 'Av. Operacional',
          number: '500',
          city: syntheticClient.city,
          state: 'RO',
          postalCode: '76800000',
          country: 'BR',
        },
      ],
    });

    stage = 'catalog:category';
    const category = await insertCatalogCategory(services.pool, {
      code: `UAT-${scenario.id.toUpperCase()}-${options?.deterministicSuffix ?? suffix}`,
      name: 'UAT',
    });

    stage = 'catalog:create';
    const draft = await services.catalogAccess.create(actor, {
      code: `UAT-SRV-${options?.deterministicSuffix ?? suffix}`,
      name: scenario.serviceName,
      categoryId: category.categoryId,
      archetype: scenario.archetype,
      measurementMode: scenario.measurementMode,
      measurementBasis: scenario.measurementBasis,
      allowedUnits: [{ unitCode: scenario.defaultUnitCode, isDefault: true, sortOrder: 0 }],
      pricingModels: [
        { modelCode: 'GLOBAL_PRICE', salePrice: '2500.0000', internalCost: '1800.0000' },
      ],
      resourceRequirements: scenario.resourceTypeCodes.map((code, index) => ({
        resourceTypeCode: code,
        requirementLevel: 'REQUIRED' as const,
        minQuantity: 1,
        sortOrder: index,
      })),
      laborRequirements: [],
      executionRequirements: [
        { requirementType: 'OBSERVATION', requirementLevel: 'REQUIRED' },
        { requirementType: 'QUANTITY', requirementLevel: 'REQUIRED' },
      ],
    });

    stage = 'catalog:publish';
    const definition = await services.catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await services.catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);

    stage = 'proposal:create';
    const proposal = await services.proposalsAccess.create(actor, {
      clientId: client.id,
      unitId,
      title: scenario.proposalTitle,
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: '7500.0000',
    });
    const issuedProposal = await services.proposalsAccess.issue(
      actor,
      proposal.proposal.id,
      1,
      proposal.currentVersion!.rowVersion,
    );
    const accepted = await services.proposalsAccess.accept(actor, proposal.proposal.id, 1, {
      rowVersion: issuedProposal.rowVersion,
      acceptanceOriginCode: PROPOSAL_ACCEPTANCE_ORIGINS.InternalApproval,
    });

    stage = 'purchase-order:create';
    const purchaseOrder = await services.purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId,
      poNumber,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      paymentTerms: '30 DDL',
      items: [
        {
          lineNumber: 1,
          description: scenario.serviceName,
          serviceDefinitionId: published.serviceDefinitionId,
          serviceDefinitionVersionId: published.id,
          quantity: '1.0000',
          unitCode: scenario.defaultUnitCode,
          unitPrice: '50000.0000',
          lineTotal: '50000.0000',
        },
      ],
    });
    const registeredPo = await services.purchaseOrdersAccess.register(actor, purchaseOrder.purchaseOrder.id, {
      rowVersion: purchaseOrder.purchaseOrder.rowVersion,
    });

    stage = 'service-request:create';
    const request = await services.serviceRequestsAccess.create(actor, {
      unitId,
      originSource: SERVICE_REQUEST_ORIGINS.ProposalAcceptance,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      proposalId: accepted.proposalId,
      purchaseOrderId: registeredPo.purchaseOrder.id,
      description: scenario.requestDescription,
      location: requestLocation,
    });
    stage = 'service-request:submit';
    const submitted = await services.serviceRequestsAccess.submit(actor, request.serviceRequest.id, {
      rowVersion: request.serviceRequest.rowVersion,
    });
    stage = 'service-request:review';
    const reviewed = await services.serviceRequestsAccess.startReview(actor, request.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    stage = 'service-request:approve';
    const approved = await services.serviceRequestsAccess.approve(actor, request.serviceRequest.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
    });

    stage = 'service-request:document';
    const document = await services.documentsAccess.createWithUpload(
      actor,
      {
        title: `Evidência UAT — ${scenario.title}`,
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId,
      },
      { buffer: minimalPdfBuffer(), filename: 'evidencia-uat.pdf', mimetype: 'application/pdf' },
    );
    assertNoStorageKeyLeak(document);
    await services.serviceRequestsAccess.linkDocument(actor, request.serviceRequest.id, {
      documentId: document.document.id,
      linkPurpose: SERVICE_REQUEST_DOCUMENT_LINK_PURPOSES.Evidence,
    });

    stage = 'service-request:convert';
    const converted = await services.serviceRequestsAccess.convert(actor, request.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });
    if (converted.serviceRequest.status !== SERVICE_REQUEST_STATUSES.Converted) {
      throw new Error(`Expected converted request, got ${converted.serviceRequest.status}`);
    }

    stage = 'service-order:load';
    let draftOrder = await services.serviceOrdersAccess.getById(
      actor,
      converted.serviceRequest.convertedServiceOrderId!,
    );
    if (scenario.archetype === 'TRANSPORT') {
      stage = 'service-order:update-transport-route';
      draftOrder = await services.serviceOrdersAccess.update(actor, draftOrder.id, {
        rowVersion: draftOrder.rowVersion,
        location: requestLocation,
      });
    }
    stage = 'service-order:prepare';
    const prepared = await services.serviceOrdersAccess.prepare(actor, draftOrder.id, {
      rowVersion: draftOrder.rowVersion,
    });

    if (options?.stopAfter === 'prepared') {
      return {
        scenarioId: scenario.id,
        status: 'PASS',
        durationMs: Date.now() - started,
        serviceOrderId: prepared.id,
      };
    }

    stage = 'service-order:release';
    const released = await services.serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });

    if (options?.stopAfter === 'released') {
      return {
        scenarioId: scenario.id,
        status: 'PASS',
        durationMs: Date.now() - started,
        serviceOrderId: released.id,
      };
    }

    stage = 'resource-types:list';
    const listed = await services.resourceTypesAccess.list(actor, { limit: 50, offset: 0 });
    for (const resourceTypeCode of scenario.resourceTypeCodes) {
      stage = `planning:plan-${resourceTypeCode}`;
      const resourceType = listed.items.find((item) => item.code === resourceTypeCode);
      if (!resourceType) {
        throw new Error(`Resource type ${resourceTypeCode} not found`);
      }
      const planned = await services.planningAccess.planResource(actor, released.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode,
        plannedQuantity: '1',
        operationalStart: plannedOperationalWindow.operationalStart,
        operationalEnd: plannedOperationalWindow.operationalEnd,
      });
      stage = `asset:create-${resourceTypeCode}`;
      const asset = await services.assetsAccess.create(actor, {
        assetCode: `${resourceTypeCode}-${suffix}`,
        resourceTypeId: resourceType.id,
        name: `${resourceType.name} UAT`,
        unitId,
        vehicle:
          resourceType.classification === 'VEHICLE'
            ? options?.vehiclePlateScenarioIndex !== undefined
              ? syntheticVehiclePlate(options.vehiclePlateScenarioIndex, resourceTypeCode)
              : {
                  plate: `U${suffix.slice(0, 1)}-${indexSuffix(resourceTypeCode)}34`,
                  normalizedPlate: `U${suffix.slice(0, 1)}${indexSuffix(resourceTypeCode)}34`.replace(/-/g, ''),
                  plateDisplay: `U${suffix.slice(0, 1)}-${indexSuffix(resourceTypeCode)}34`,
                }
            : undefined,
      });
      stage = `planning:allocate-${resourceTypeCode}`;
      await services.planningAccess.allocateResource(actor, released.id, {
        plannedResourceId: planned.id,
        physicalAssetId: asset.id,
        operationalStart: '2026-07-01T08:00:00.000Z',
        operationalEnd: '2026-07-01T18:00:00.000Z',
      });
    }

    stage = 'execution:start';
    const startedExecution = await services.executionAccess.start(actor, released.id, {
      rowVersion: released.rowVersion,
    });
    stage = 'execution:observation';
    await services.executionAccess.recordObservation(actor, startedExecution.id, {
      rowVersion: startedExecution.rowVersion,
      text: scenario.executionObservation,
    });
    const afterObservation = await services.serviceOrdersAccess.getById(actor, startedExecution.id);
    stage = 'execution:quantity';
    await services.executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: scenario.quantityValue,
      unitCode: scenario.defaultUnitCode,
    });
    const afterQuantity = await services.serviceOrdersAccess.getById(actor, startedExecution.id);
    stage = 'execution:complete';
    const completed = await services.executionAccess.complete(actor, afterQuantity.id, {
      rowVersion: afterQuantity.rowVersion,
    });

    if (options?.stopAfter === 'completed_execution') {
      return {
        scenarioId: scenario.id,
        status: 'PASS',
        durationMs: Date.now() - started,
        serviceOrderId: completed.id,
      };
    }

    stage = 'measurement:create';
    const measurement = await services.measurementsAccess.create(actor, completed.id);
    stage = 'measurement:submit';
    const submittedMeasurement = await services.measurementsAccess.submit(actor, completed.id, measurement.id, {
      rowVersion: measurement.rowVersion,
    });
    stage = 'measurement:review';
    const reviewedMeasurement = await services.measurementsAccess.startReview(actor, completed.id, measurement.id, {
      rowVersion: submittedMeasurement.rowVersion,
    });
    stage = 'measurement:approve';
    const measurementReviewer =
      options?.reviewer ?? (await createMeasurementReviewer(services.pool, actor.identityId));
    const approvedMeasurement = await services.measurementsAccess.approve(
      measurementReviewer,
      completed.id,
      measurement.id,
      {
        rowVersion: reviewedMeasurement.rowVersion,
      },
    );
    if (approvedMeasurement.status !== MEASUREMENT_STATUSES.Approved) {
      throw new Error(`Measurement not approved: ${approvedMeasurement.status}`);
    }

    if (options?.stopAfter === 'measurement_approved') {
      return {
        scenarioId: scenario.id,
        status: 'PASS',
        durationMs: Date.now() - started,
        serviceOrderId: completed.id,
        measurementId: approvedMeasurement.id,
      };
    }

    stage = 'billing:prepare';
    const billing = await services.billingAccess.prepare(actor, completed.id, {
      measurementId: approvedMeasurement.id,
      paymentTerms: '30 DDL',
    });
    stage = 'billing:issue-document';
    const notaFatura = await services.billingDocumentAccess.issue(actor, completed.id, billing.id, {
      dueDate: '2026-10-31',
    });
    if (notaFatura.status !== BILLING_DOCUMENT_STATUSES.Finalized) {
      throw new Error(`Nota fatura not finalized: ${notaFatura.status}`);
    }
    if (notaFatura.purchaseOrderNumberSnapshot !== poNumber) {
      throw new Error('PO snapshot mismatch on billing document');
    }
    assertNoStorageKeyLeak(notaFatura);

    stage = 'billing:download-pdf';
    const pdf = await services.billingDocumentAccess.downloadPdf(actor, completed.id, billing.id, notaFatura.id);
    if (pdf.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new Error('Billing PDF artifact invalid');
    }

    const artifacts: MasterBusinessArtifacts | undefined = options?.captureArtifacts
      ? {
          scenarioId: scenario.id,
          runSuffix: suffix,
          actorIdentityId: actor.identityId,
          clientId: client.id,
          clientLegalNameAtCreate: client.legalName,
          clientTaxIdAtCreate: client.taxId,
          serviceDefinitionId: published.serviceDefinitionId,
          serviceDefinitionVersionId: published.id,
          publishedVersionNumber: published.version,
          publishedServiceCode: published.code,
          proposalId: proposal.proposal.id,
          proposalVersionNumber: 1,
          proposalClientSnapshot: issuedProposal.clientSnapshot ?? {},
          purchaseOrderId: registeredPo.purchaseOrder.id,
          poNumber,
          poClientSnapshot: registeredPo.purchaseOrder.clientSnapshot ?? {},
          serviceRequestId: request.serviceRequest.id,
          serviceOrderId: completed.id,
          measurementId: approvedMeasurement.id,
          billingRecordId: billing.id,
          billingDocumentId: notaFatura.id,
        }
      : undefined;

    return {
      scenarioId: scenario.id,
      status: 'PASS',
      durationMs: Date.now() - started,
      serviceOrderId: completed.id,
      billingDocumentId: notaFatura.id,
      artifacts,
    };
  } catch (error) {
    return {
      scenarioId: scenario.id,
      status: 'FAIL',
      durationMs: Date.now() - started,
      error: `[${stage}] ${formatUatScenarioError(error)}`,
    };
  }
}

function formatUatScenarioError(error: unknown): string {
  if (error instanceof Error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    if (response !== undefined) {
      return `${error.name}: ${JSON.stringify(response)}`;
    }
    return error.message;
  }
  return String(error);
}

function indexSuffix(code: string): string {
  return code.slice(0, 2);
}

async function createMeasurementReviewer(pool: Pool, grantedBy: string): Promise<UatActor> {
  const login = normalizeLoginIdentifier(`uat-reviewer-${crypto.randomUUID()}@cisne.invalid`);
  const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
  const { identityId } = await insertIdentity(pool, login, passwordHash);
  await grantUatProfile(pool, identityId, grantedBy, 'control_admin');
  return { identityId, sessionId: 'sid-reviewer' };
}
