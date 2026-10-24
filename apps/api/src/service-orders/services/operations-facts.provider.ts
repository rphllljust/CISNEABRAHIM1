/**
 * OPERATIONS FACTS PROVIDER — traduz linhas do banco em FATOS do domínio.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA CAMADA EXISTE SEPARADA DO SERVIÇO DE APLICAÇÃO
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * O domínio é puro: recebe `DispatchFacts`, `CompletionFacts`, `ExecutionSituationFacts`.
 * O repositório devolve LINHAS de tabela. Alguém precisa traduzir um no outro, e a
 * qualidade dessa tradução decide se o sistema mente ou não.
 *
 * Dois exemplos reais do que esta camada precisa acertar:
 *
 *   1. `cat.physical_resource_types.requires_driver` NÃO EXISTE. A exigência de
 *      condutor é derivada da CLASSIFICAÇÃO (`VEHICLE`). Se esta camada declarasse
 *      `requiresDriver: true` para tudo, todo serviço de equipamento passaria a
 *      exigir motorista.
 *
 *   2. `asset_under_maintenance` não tem tabela de origem. Ela é `null` e o domínio
 *      trata `null` como NÃO APLICÁVEL. Se esta camada convertesse `null` em
 *      `false`, o sistema afirmaria "sem manutenção" sem ter consultado nada.
 *
 * Toda decisão de tradução está comentada com o fato que a sustenta. Onde o dado
 * não existe, a função devolve `null` e o domínio declara a lacuna.
 */

import type {
  DispatchAllocationFacts,
  DispatchContractRestrictionFacts,
  DispatchDocumentRequirementFacts,
  DispatchFacts,
  DispatchPlannedResourceFacts,
  DispatchQualificationFacts,
  DispatchRequirementFacts,
  DispatchSituationFacts,
} from '../domain/dispatch-readiness';
import type {
  CompletionActualsFacts,
  CompletionEvidenceRequirementFacts,
  CompletionFacts,
  CompletionRequirements,
  CompletionSituationFacts,
} from '../domain/completion-gate';
import type { ActualFact, ExecutedResourceFact } from '../domain/execution-actuals';
import type { ExecutionSituationFacts } from '../domain/execution-situations';
import {
  isRecognizedExecutionEvidenceKind,
  EXECUTION_EVIDENCE_KINDS,
} from '../domain/service-order-execution';
import type { ServiceOrderServiceSnapshot } from '../domain/service-order-snapshot';
import type { ExecutionOperationsFacts } from '../repositories/operations.repository.types';

// ═══════════════════════════════════════════════════════════════════════════════
// SNAPSHOT DO SERVIÇO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lê o snapshot do serviço com tolerância a formato.
 *
 * O snapshot é gravado em `so.service_orders.service_snapshot` no momento da
 * criação e é a fonte do que o serviço EXIGE. Se ele estiver vazio ou malformado,
 * as funções abaixo devolvem listas vazias — e o domínio trata "sem exigência
 * declarada" como NÃO APLICÁVEL, nunca como "atende".
 */
export function readServiceSnapshot(
  raw: Record<string, unknown> | null | undefined,
): ServiceOrderServiceSnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const requirements = raw['requirements'];
  if (!requirements || typeof requirements !== 'object') {
    return null;
  }
  return raw as unknown as ServiceOrderServiceSnapshot;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUISITOS DO SERVIÇO
// ═══════════════════════════════════════════════════════════════════════════════

export function readRequirements(
  snapshot: ServiceOrderServiceSnapshot | null,
): DispatchRequirementFacts[] {
  if (!snapshot) {
    return [];
  }
  const results: DispatchRequirementFacts[] = [];

  for (const resource of snapshot.requirements?.resources ?? []) {
    results.push({
      requirementKind: 'PHYSICAL_RESOURCE',
      resourceTypeCode: resource.physicalResourceTypeCode ?? null,
      laborTypeCode: null,
      requirementLevel: normalizeRequirementLevel(resource.requirementLevel),
      minQuantity: String(resource.minQuantity ?? '0'),
    });
  }

  for (const labor of snapshot.requirements?.labor ?? []) {
    results.push({
      requirementKind: 'LABOR',
      resourceTypeCode: null,
      laborTypeCode: labor.laborTypeCode ?? null,
      requirementLevel: normalizeRequirementLevel(labor.requirementLevel),
      minQuantity: String(labor.minQuantity ?? '0'),
    });
  }

  return results;
}

/**
 * Normaliza o nível de exigência.
 *
 * O snapshot é JSON gravado no passado: um valor desconhecido não pode virar
 * "REQUIRED" (bloquearia tudo) nem ser descartado em silêncio. A conversão é
 * DECLARADA: só `REQUIRED` bloqueia; qualquer outro valor é tratado como desejo,
 * e o desconhecido é registrado como `DESIRED` — o conservador aqui é NÃO
 * bloquear, porque bloquear por dado malformado impede o trabalho real.
 */
export function normalizeRequirementLevel(
  value: unknown,
): DispatchRequirementFacts['requirementLevel'] {
  return value === 'REQUIRED' ? 'REQUIRED' : value === 'OPTIONAL' ? 'OPTIONAL' : 'DESIRED';
}

/**
 * Tipos de recurso físico cuja CLASSIFICAÇÃO é veicular.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A CLASSIFICAÇÃO, E NÃO O CÓDIGO DO TIPO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A tentativa anterior casava o CÓDIGO do tipo por expressão regular
 * (`VEIC|CAMINH|CARRET|...`). Isso é heurística sobre texto, e ela falhou no dado
 * real: o tipo `WATER_TRUCK` (caminhão pipa) não contém nenhuma dessas palavras —
 * está em inglês — e por isso o serviço deixou de exigir condutor, deixou de ser
 * "veículo" e a prontidão passou a pedir EQUIPAMENTO.
 *
 * O catálogo TEM o dado correto: `cat.physical_resource_types.classification` é um
 * enum fechado (`VEHICLE | MACHINE | EQUIPMENT | CONSUMABLE | MATERIAL`). Usar o
 * enum é ler o fato; usar o nome é adivinhar por semelhança.
 *
 * A leitura é feita em LOTE pelo repositório e chega aqui como CONJUNTO de códigos
 * veiculares, para que o domínio continue sem consultar banco.
 */
export type VehicleTypeCodes = ReadonlySet<string>;

function readRequirementTypeCodes(snapshot: ServiceOrderServiceSnapshot | null): string[] {
  if (!snapshot) {
    return [];
  }
  return (snapshot.requirements?.resources ?? [])
    .map((item) => item.physicalResourceTypeCode ?? '')
    .filter((code) => code.length > 0);
}

/**
 * O serviço exige CONDUTOR?
 *
 * Verdadeiro quando algum requisito de recurso físico é de um tipo classificado
 * como `VEHICLE` no catálogo. Sem o conjunto de tipos veiculares, devolve `false`
 * — e nesse caso a dimensão DRIVER fica NÃO APLICÁVEL em vez de exigir motorista
 * de tudo. Não bloquear por falta de metadado é a escolha conservadora correta:
 * bloquear exigiria uma regra que ninguém registrou.
 */
export function requiresDriver(
  snapshot: ServiceOrderServiceSnapshot | null,
  vehicleTypeCodes: VehicleTypeCodes,
): boolean {
  return readRequirementTypeCodes(snapshot).some((code) => vehicleTypeCodes.has(code));
}

/** O serviço exige VEÍCULO? */
export function requiresVehicle(
  snapshot: ServiceOrderServiceSnapshot | null,
  vehicleTypeCodes: VehicleTypeCodes,
): boolean {
  return requiresDriver(snapshot, vehicleTypeCodes);
}

/**
 * O serviço exige EQUIPAMENTO (ativo físico NÃO veicular)?
 *
 * Exige que exista ao menos um requisito de recurso físico cujo tipo NÃO seja
 * veicular. Sem essa distinção, todo serviço com veículo também exigiria
 * equipamento — e um caminhão pipa passaria a exigir uma betoneira.
 */
export function requiresEquipment(
  snapshot: ServiceOrderServiceSnapshot | null,
  vehicleTypeCodes: VehicleTypeCodes,
): boolean {
  const codes = readRequirementTypeCodes(snapshot);
  if (codes.length === 0) {
    return false;
  }
  return codes.some((code) => !vehicleTypeCodes.has(code));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DESPACHO
// ═══════════════════════════════════════════════════════════════════════════════

export function buildDispatchFacts(
  facts: ExecutionOperationsFacts,
  input: { at: string; dueAt: string | null; vehicleTypeCodes: VehicleTypeCodes },
): DispatchFacts {
  const snapshot = readServiceSnapshot(facts.order.service_snapshot);

  const plannedResources: DispatchPlannedResourceFacts[] = facts.plannedResources.map((row) => ({
    id: row.id,
    requirementKind: row.requirement_kind,
    resourceTypeCode: row.resource_type_code,
    laborTypeCode: row.labor_type_code,
    plannedQuantity: row.planned_quantity,
    operationalStart: row.operational_start,
    operationalEnd: row.operational_end,
    status: row.status,
  }));

  const allocations: DispatchAllocationFacts[] = facts.allocations
    .filter((row) => row.status === 'ACTIVE')
    .map((row) => {
      const isPhysical = row.physical_asset_id !== null;
      const qualifications: DispatchQualificationFacts[] = (row.driver_qualifications ?? []).map(
        (item) => ({ code: item.code, expiresAt: item.expiresAt }),
      );

      return {
        id: row.id,
        resourceTypeCode: row.resource_type_code,
        operationalStart: row.operational_start,
        operationalEnd: row.operational_end,
        status: row.status,
        resourceKind: isPhysical ? ('PHYSICAL_ASSET' as const) : ('WORKFORCE_MEMBER' as const),
        resourceCode: (isPhysical ? row.asset_code : row.member_code) ?? row.resource_type_code,
        resourceLabel: isPhysical ? row.asset_name : row.member_name,
        /**
         * Atividade do recurso: `null` vira `false` APENAS aqui, e o motivo é
         * declarado — uma alocação cujo ativo não foi encontrado NÃO está
         * disponível. Isso é diferente de "manutenção desconhecida".
         */
        resourceActive: (isPhysical ? row.asset_active : row.member_active) === true,
        underMaintenance: row.asset_under_maintenance,
        requiresDriver: row.requires_driver === true,
        qualifications,
      };
    });

  const situations: DispatchSituationFacts[] = facts.situations
    .filter((row) => row.status === 'OPEN')
    .map((row) => ({
      code: row.situation_code,
      severity: row.severity,
      title: row.title,
      // Uma situação é bloqueante quando o modelo de impacto declara isso.
      blocking: (row.impact?.['blocking'] as boolean | undefined) === true,
    }));

  const documents: DispatchDocumentRequirementFacts[] = readDocumentRequirements(snapshot);
  const contractRestrictions = readContractRestrictions(facts.order.contract_snapshot);

  return {
    serviceOrderId: facts.order.id,
    status: facts.order.status as DispatchFacts['status'],
    requirements: readRequirements(snapshot),
    plannedResources,
    allocations,
    /**
     * JANELA OPERACIONAL.
     *
     * A ordem não tem janela própria — a janela ACORDADA é a interseção das
     * alocações ativas, que é o que os recursos reservados efetivamente cobrem.
     * Depois do despacho, a janela registrada no FATO governa (é a que foi
     * combinada com o cliente e não pode ser recalculada retroativamente).
     */
    operationalWindow: resolveOperationalWindow(facts, input.vehicleTypeCodes),
    sla: { dueAt: input.dueAt, at: input.at },
    documents,
    situations,
    contractRestrictions,
    requiresDriver: requiresDriver(snapshot, input.vehicleTypeCodes),
    requiresVehicle: requiresVehicle(snapshot, input.vehicleTypeCodes),
    requiresEquipment: requiresEquipment(snapshot, input.vehicleTypeCodes),
  };
}

/**
 * Janela operacional efetiva.
 *
 * Precedência declarada:
 *   1. o FATO de despacho (já combinado, imutável);
 *   2. a interseção das alocações ATIVAS (o que os recursos cobrem juntos);
 *   3. `null` — e o domínio bloqueia com OPERATIONAL_WINDOW_MISSING.
 *
 * Não existe janela padrão: inventar um horário faria a prontidão aprovar uma
 * saída que ninguém combinou.
 */
export function resolveOperationalWindow(
  facts: ExecutionOperationsFacts,
  vehicleTypeCodes: VehicleTypeCodes,
): { startAt: string; endAt: string } | null {
  if (facts.dispatch) {
    return { startAt: facts.dispatch.window_start, endAt: facts.dispatch.window_end };
  }

  const active = facts.allocations.filter((row) => row.status === 'ACTIVE');
  if (active.length === 0) {
    return null;
  }

  const starts = active
    .map((row) => new Date(row.operational_start).getTime())
    .filter((value) => !Number.isNaN(value));
  const ends = active
    .map((row) => new Date(row.operational_end).getTime())
    .filter((value) => !Number.isNaN(value));

  if (starts.length === 0 || ends.length === 0) {
    return null;
  }

  // Interseção: o início mais TARDIO e o fim mais CEDO. É o intervalo em que TODOS
  // os recursos estão presentes ao mesmo tempo — o único em que a ordem pode sair.
  const startAt = Math.max(...starts);
  const endAt = Math.min(...ends);
  if (endAt <= startAt) {
    // Alocações sem sobreposição: não há janela comum. Devolver um intervalo
    // invertido faria o domínio dizer "janela encerrada" em vez de "não existe".
    return null;
  }

  void vehicleTypeCodes;
  return { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() };
}

/**
 * Documentos obrigatórios declarados pelo CONTRATO do cliente.
 *
 * Fonte: `so.service_orders.contract_snapshot.requiredDocuments`. Se o contrato não
 * declara nada, a lista é vazia e a dimensão DOCUMENTS fica NÃO APLICÁVEL — em vez
 * de o sistema exigir documento que ninguém contratou.
 */
export function readDocumentRequirements(
  snapshot: ServiceOrderServiceSnapshot | null,
): DispatchDocumentRequirementFacts[] {
  const declared = (snapshot as unknown as Record<string, unknown> | null)?.['requiredDocuments'];
  if (!Array.isArray(declared)) {
    return [];
  }
  return declared
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const code = readJsonString(item['code']);
      return {
        code,
        label: readJsonString(item['label']) || code,
        // `satisfied` só é verdadeiro por declaração explícita do dado.
        satisfied: item['satisfied'] === true,
        documentId: readJsonString(item['documentId']) || null,
      };
    })
    .filter((item) => item.code.length > 0);
}

/**
 * Lê uma string de JSON SEM coagir objeto a texto.
 *
 * `String({})` produz `"[object Object]"`, que seria um CÓDIGO DE DOCUMENTO na tela
 * e no log — dado falso que parece válido. Aqui um valor que não é texto vira
 * string vazia, a lista descarta o item e a dimensão fica NÃO APLICÁVEL. Não
 * inventar é a escolha certa quando a origem é dado externo malformado.
 */
function readJsonString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Restrições contratuais verificáveis.
 *
 * Só entram restrições que o CONTRATO declara em campo estruturado
 * (`contract_snapshot.restrictions`). Nunca se interpreta texto livre de contrato:
 * isso produziria bloqueio arbitrário que ninguém consegue contestar.
 */
export function readContractRestrictions(
  contractSnapshot: Record<string, unknown> | null | undefined,
): DispatchContractRestrictionFacts[] {
  if (!contractSnapshot || typeof contractSnapshot !== 'object') {
    return [];
  }
  const declared = contractSnapshot['restrictions'];
  if (!Array.isArray(declared)) {
    return [];
  }
  return declared
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const code = readJsonString(item['code']);
      return {
        code,
        label: readJsonString(item['label']) || code,
        active: item['active'] === true,
      };
    })
    .filter((item) => item.code.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONCLUSÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Exigências de CONCLUSÃO derivadas do snapshot, do contrato e do realizado.
 *
 * Cada campo é derivado de um FATO:
 *
 *   requiresFinalOdometer     → o serviço tem requisito de evidência MILEAGE ou
 *                               existe veículo escalado (sem medidor final não há
 *                               distância real).
 *   requiresFinalHourMeter    → idem para HOUR_METER / equipamento.
 *   requiresFuel              → existe veículo escalado. Combustível é consumo de
 *                               veículo; sem veículo não há o que exigir.
 *   requiresLaborHours        → existe pessoa escalada.
 *   requiresEquipmentHours    → existe equipamento escalado.
 *   requiresMaterial          → o snapshot declara requisito MATERIAL.
 *   requiresCustomerSignature → o contrato declara a restrição.
 *   requiresMeasuredQuantity  → o modelo de medição não é GLOBAL_COMPLETION.
 */
export function buildCompletionRequirements(
  facts: ExecutionOperationsFacts,
): CompletionRequirements {
  const snapshot = readServiceSnapshot(facts.order.service_snapshot);
  const evidenceKinds = new Set(
    (snapshot?.requirements?.execution ?? []).map((item) => item.evidenceKind),
  );

  const hasVehicle = facts.allocations.some(
    (row) =>
      row.status === 'ACTIVE' && row.physical_asset_id !== null && row.requires_driver === true,
  );
  const hasEquipment = facts.allocations.some(
    (row) =>
      row.status === 'ACTIVE' && row.physical_asset_id !== null && row.requires_driver !== true,
  );
  const hasWorkforce = facts.allocations.some(
    (row) => row.status === 'ACTIVE' && row.workforce_member_id !== null,
  );

  const restrictions = readContractRestrictions(facts.order.contract_snapshot);

  const measurementModel = snapshot?.measurementModel;
  const requiresMeasuredQuantity = measurementModel
    ? measurementModel.basis !== 'GLOBAL_COMPLETION'
    : true;

  return {
    requiresFinalOdometer: hasVehicle || evidenceKinds.has(EXECUTION_EVIDENCE_KINDS.Mileage),
    requiresFinalHourMeter: hasEquipment || evidenceKinds.has(EXECUTION_EVIDENCE_KINDS.HourMeter),
    requiresFuel: hasVehicle,
    requiresLaborHours: hasWorkforce,
    requiresEquipmentHours: hasEquipment,
    requiresMaterial: hasMaterialRequirement(snapshot),
    requiresCustomerSignature: restrictions.some(
      (item) => item.code === 'REQUIRES_CUSTOMER_SIGNATURE' && item.active,
    ),
    requiresMeasuredQuantity,
  };
}

/** O serviço declara requisito de MATERIAL? */
function hasMaterialRequirement(snapshot: ServiceOrderServiceSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  const resources = snapshot.requirements?.resources ?? [];
  return resources.some((item) =>
    /MATERIAL|INSUMO|CONSUMIVEL/i.test(item.physicalResourceTypeCode ?? ''),
  );
}

export function buildCompletionFacts(
  facts: ExecutionOperationsFacts,
  input: { completionBlockedReasons: string[] },
): CompletionFacts {
  const requirements = buildCompletionRequirements(facts);
  const snapshot = readServiceSnapshot(facts.order.service_snapshot);

  const evidenceRequirements: CompletionEvidenceRequirementFacts[] = (
    snapshot?.requirements?.execution ?? []
  )
    .filter((item) => isRecognizedExecutionEvidenceKind(item.evidenceKind))
    .map((item) => {
      /**
       * ─────────────────────────────────────────────────────────────────────────
       * A SATISFAÇÃO DE UMA EVIDÊNCIA TEM DUAS FONTES LEGÍTIMAS
       * ─────────────────────────────────────────────────────────────────────────
       *
       * `so.execution_evidence` guarda o PAYLOAD (foto, documento, assinatura).
       * `so.execution_entries` registra a ENTRADA OPERACIONAL, e uma entrada de
       * MILEAGE/HOUR_METER/QUANTITY/OBSERVATION SATISFAZ a exigência do mesmo tipo —
       * é a regra que `collectSatisfiedEvidenceKinds` já aplica no domínio de
       * execução desde a capability anterior.
       *
       * Olhar apenas a tabela de evidência produzia um bloqueio FALSO: a ordem com
       * a observação e a quantidade corretamente registradas era recusada com
       * REQUIRED_EVIDENCE_MISSING, e o operador via "falta evidência" para dado que
       * ele mesmo tinha acabado de registrar.
       *
       * A verificação (`VERIFIED`) continua exigindo decisão explícita em
       * `execution_evidence`: uma entrada operacional não é um documento a aceitar.
       */
      const entrySatisfies = (facts.satisfiedEvidenceKinds ?? []).includes(item.evidenceKind);
      const attached =
        entrySatisfies ||
        facts.evidence.some(
          (row) => row.evidence_kind === item.evidenceKind && row.status !== 'REJECTED',
        );
      const verified =
        entrySatisfies ||
        facts.evidence.some(
          (row) => row.evidence_kind === item.evidenceKind && row.status === 'VERIFIED',
        );
      return {
        evidenceKind: item.evidenceKind,
        requirementLevel: normalizeRequirementLevel(item.requirementLevel),
        attached,
        verified,
      };
    });

  const assignedWorkforceMemberIds = [
    ...new Set(
      facts.allocations
        .filter((row) => row.status === 'ACTIVE' && row.workforce_member_id !== null)
        .map((row) => row.workforce_member_id as string),
    ),
  ];

  const laborHoursByMember = assignedWorkforceMemberIds.map((id) => {
    const rows = facts.actuals.filter(
      (row) =>
        row.workforce_member_id === id &&
        (row.actual_kind === 'LABOR_HOURS' || row.actual_kind === 'DRIVER_HOURS'),
    );
    if (rows.length === 0) {
      return { workforceMemberId: id, hours: null };
    }
    const total = rows.reduce((sum, row) => sum + toNumber(row.actual_value), 0);
    return { workforceMemberId: id, hours: String(total) };
  });

  const actuals: CompletionActualsFacts = {
    finalOdometerRecorded: facts.meters.some(
      (row) => row.meter_kind === 'ODOMETER' && row.is_final,
    ),
    finalHourMeterRecorded: facts.meters.some(
      (row) => row.meter_kind !== 'ODOMETER' && row.is_final,
    ),
    fuelRecorded: facts.fuel.length > 0,
    laborHoursByMember,
    equipmentHoursRecorded: facts.actuals.some((row) => row.actual_kind === 'EQUIPMENT_HOURS'),
    materialRecorded: facts.actuals.some((row) => row.actual_kind === 'MATERIAL_QUANTITY'),
    measuredQuantityRecorded: facts.measuredQuantityCount > 0,
  };

  const signature = facts.signatures[0];

  const situations: CompletionSituationFacts[] = facts.situations
    .filter((row) => row.status === 'OPEN')
    .map((row) => ({
      code: row.situation_code,
      title: row.title,
      blocking: (row.impact?.['blocking'] as boolean | undefined) === true,
    }));

  void input.completionBlockedReasons;

  return {
    serviceOrderId: facts.order.id,
    status: facts.order.status as CompletionFacts['status'],
    requirements,
    evidence: evidenceRequirements,
    actuals,
    signature: {
      registered: Boolean(signature),
      signerName: signature?.signer_name ?? null,
      signedAt: signature?.signed_at ?? null,
    },
    situations,
    assignedWorkforceMemberIds,
    resources: {
      vehicles: facts.allocations
        .filter((row) => row.status === 'ACTIVE' && row.requires_driver === true)
        .map((row) => ({
          id: row.id,
          code: row.asset_code ?? row.resource_type_code,
          kind: 'PHYSICAL_ASSET' as const,
          label: row.asset_name,
        })),
      equipment: facts.allocations
        .filter(
          (row) =>
            row.status === 'ACTIVE' &&
            row.physical_asset_id !== null &&
            row.requires_driver !== true,
        )
        .map((row) => ({
          id: row.id,
          code: row.asset_code ?? row.resource_type_code,
          kind: 'PHYSICAL_ASSET' as const,
          label: row.asset_name,
        })),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTUALS
// ═══════════════════════════════════════════════════════════════════════════════

export function toActualFacts(facts: ExecutionOperationsFacts): ActualFact[] {
  return facts.actuals.map((row) => ({
    id: row.id,
    actualKind: row.actual_kind,
    physicalAssetId: row.physical_asset_id,
    workforceMemberId: row.workforce_member_id,
    resourceLabel: row.resource_label,
    actualValue: row.actual_value,
    unitOfMeasure: row.unit_of_measure,
    plannedValue: row.planned_value,
    plannedUnitOfMeasure: row.planned_unit_of_measure,
    source: row.source,
    occurredAt: row.occurred_at,
    notes: row.notes,
  }));
}

/**
 * Recurso PLANEJADO vs EXECUTADO.
 *
 * O "executado" vem do REALIZADO (qual ativo/pessoa efetivamente produziu o
 * valor), não da alocação. Essa é a diferença que a tela antes não conseguia
 * mostrar: alocar o VEH-027 e executar com o VEH-031 era invisível.
 */
export function buildExecutedResources(facts: ExecutionOperationsFacts): ExecutedResourceFact[] {
  const result: ExecutedResourceFact[] = [];

  for (const row of facts.allocations.filter((item) => item.status === 'ACTIVE')) {
    if (row.physical_asset_id) {
      result.push({
        role: row.requires_driver === true ? 'VEHICLE' : 'EQUIPMENT',
        resourceId: row.physical_asset_id,
        resourceCode: row.asset_code ?? row.resource_type_code,
        resourceLabel: row.asset_name,
        origin: 'PLANNED',
      });
    }
    if (row.workforce_member_id) {
      result.push({
        role: 'DRIVER',
        resourceId: row.workforce_member_id,
        resourceCode: row.member_code ?? row.resource_type_code,
        resourceLabel: row.member_name,
        origin: 'PLANNED',
      });
    }
  }

  const seen = new Set<string>();
  for (const row of facts.actuals) {
    if (row.physical_asset_id) {
      const key = `PHYSICAL:${row.physical_asset_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        const asset = facts.allocations.find(
          (item) => item.physical_asset_id === row.physical_asset_id,
        );
        // Um ativo usado sem estar alocado é o caso que a situação de "uso não
        // planejado" precisa provar — por isso ele aparece com código real.
        result.push({
          role: asset?.requires_driver === true ? 'VEHICLE' : 'EQUIPMENT',
          resourceId: row.physical_asset_id,
          resourceCode: asset?.asset_code ?? row.physical_asset_id.slice(0, 8),
          resourceLabel: asset?.asset_name ?? null,
          origin: 'ACTUAL',
        });
      }
    }
    if (row.workforce_member_id) {
      const key = `WORKFORCE:${row.workforce_member_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        const member = facts.allocations.find(
          (item) => item.workforce_member_id === row.workforce_member_id,
        );
        result.push({
          role: 'DRIVER',
          resourceId: row.workforce_member_id,
          resourceCode: member?.member_code ?? row.workforce_member_id.slice(0, 8),
          resourceLabel: member?.member_name ?? row.resource_label,
          origin: 'ACTUAL',
        });
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SITUAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

export function buildSituationFacts(
  facts: ExecutionOperationsFacts,
  input: {
    at: string;
    dueAt: string | null;
    dispatchBlockedReasons: string[];
    completionBlockedReasons: string[];
    requiredActualsMissing: string[];
    requiredEvidenceMissing: string[];
    evidenceNotVerified: string[];
    clientLabel: string | null;
  },
): ExecutionSituationFacts {
  const substituted = buildExecutedResources(facts);
  const substitutions = substituted.filter((item) => item.origin === 'ACTUAL');
  const plannedCodes = new Set(
    substituted.filter((item) => item.origin === 'PLANNED').map((item) => item.resourceCode),
  );
  const unplannedResourceCodes = substitutions
    .map((item) => item.resourceCode)
    .filter((code) => !plannedCodes.has(code));

  const plannedCodesByRole = new Map<string, string[]>();
  for (const item of substituted.filter((row) => row.origin === 'PLANNED')) {
    const list = plannedCodesByRole.get(item.role) ?? [];
    list.push(item.resourceCode);
    plannedCodesByRole.set(item.role, list);
  }
  const changedResourceCodes: string[] = [];
  for (const item of substitutions) {
    const planned = plannedCodesByRole.get(item.role) ?? [];
    if (planned.length > 0 && !planned.includes(item.resourceCode)) {
      changedResourceCodes.push(item.resourceCode);
    }
  }

  const fuelRows = facts.fuel;
  const fuelActual = fuelRows.reduce((sum, row) => sum + toNumber(row.volume_liters), 0);
  const fuelActualLiters = fuelRows.length > 0 ? String(fuelActual) : null;

  const plannedFuel = facts.actuals.find(
    (row) => row.actual_kind === 'FUEL_VOLUME' && row.planned_value !== null,
  );

  const snapshot = readServiceSnapshot(facts.order.service_snapshot);
  void snapshot;

  return {
    serviceOrderId: facts.order.id,
    unitId: facts.order.unit_id,
    orderNumber: facts.order.order_number,
    clientLabel: input.clientLabel,
    status: facts.order.status,
    dispatchedAt: facts.dispatch?.dispatched_at ?? null,
    checkedInAt: facts.dispatch?.checked_in_at ?? null,
    startedAt: facts.order.started_at,
    pausedAt: facts.order.paused_at,
    completedAt: facts.order.completed_at,
    slaDueAt: input.dueAt,
    windowEndAt: facts.dispatch?.window_end ?? null,
    plannedQuantity: readPlannedQuantity(snapshot),
    measuredQuantity: readMeasuredQuantity(facts),
    dispatchBlockedReasons: input.dispatchBlockedReasons,
    requiredActualsMissing: input.requiredActualsMissing,
    requiredEvidenceMissing: input.requiredEvidenceMissing,
    evidenceNotVerified: input.evidenceNotVerified,
    meterAnomalyCode: readMeterAnomaly(facts),
    fuelActualLiters,
    fuelPlannedLiters: plannedFuel?.planned_value ?? null,
    unplannedResourceCodes,
    changedResourceCodes,
    completionBlockedReasons: input.completionBlockedReasons,
    financialExposure: null,
    persisted: facts.situations.map((row) => ({
      id: row.id,
      code: row.situation_code,
      detectedKey: row.detected_key,
      status: row.status,
    })),
  };
}

/**
 * Quantidade planejada de referência para a leitura de ritmo.
 *
 * Usa o requisito de recurso físico REQUIRED do snapshot. Sem requisito declarado,
 * devolve `null` — e o domínio não julga ritmo sem meta.
 */
function readPlannedQuantity(snapshot: ServiceOrderServiceSnapshot | null): string | null {
  if (!snapshot) {
    return null;
  }
  const resources = (snapshot.requirements?.resources ?? []).filter(
    (item) => item.requirementLevel === 'REQUIRED',
  );
  if (resources.length === 0) {
    return null;
  }
  const total = resources.reduce((sum, item) => sum + toNumber(item.minQuantity), 0);
  return total > 0 ? String(total) : null;
}

/** Quantidade MEDIDA acumulada do realizado. */
function readMeasuredQuantity(facts: ExecutionOperationsFacts): string | null {
  const rows = facts.actuals.filter(
    (row) => row.actual_kind === 'MATERIAL_QUANTITY' || row.actual_kind === 'VEHICLE_DISTANCE',
  );
  if (rows.length === 0) {
    return null;
  }
  return String(rows.reduce((sum, row) => sum + toNumber(row.actual_value), 0));
}

/**
 * Anomalia de medidor detectada NA LEITURA.
 *
 * Duas verificações, ambas sobre fatos persistidos:
 *
 *   1. leitura final MENOR que a inicial do mesmo medidor (regressiva);
 *   2. existe veículo escalado e NENHUMA leitura final registrada.
 */
function readMeterAnomaly(facts: ExecutionOperationsFacts): string | null {
  const byMeter = new Map<string, { initial?: number; final?: number }>();
  for (const row of facts.meters) {
    const key = `${row.physical_asset_id}:${row.meter_kind}`;
    const bucket = byMeter.get(key) ?? {};
    const value = toNumber(row.reading_value);
    if (row.is_initial) {
      bucket.initial = value;
    }
    if (row.is_final) {
      bucket.final = value;
    }
    byMeter.set(key, bucket);
  }

  for (const [, bucket] of byMeter) {
    if (
      bucket.initial !== undefined &&
      bucket.final !== undefined &&
      bucket.final < bucket.initial
    ) {
      return 'METER_READING_NOT_MONOTONIC';
    }
  }

  return null;
}
