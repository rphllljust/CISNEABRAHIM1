/**
 * Vida operacional do recurso físico.
 *
 * Projeção derivada pelo BACKEND a partir das alocações reais (`res.resource_allocations`). O
 * frontend é passivo: renderiza apenas o que veio autorizado e, quando um elo não vem, apenas
 * declara a ausência — nunca busca em outro endpoint nem infere existência.
 *
 * Leituras (km/horímetro) NÃO aparecem: a execução não tem elo persistido com o ativo (PARK).
 */
export type AssetOperationalUsage = {
  allocationId: string;
  serviceOrderId: string;
  orderNumber: string;
  orderStatus: string;
  operationalStart: string;
  operationalEnd: string;
  allocationStatus: string;
  timing: 'CURRENT' | 'PAST' | 'FUTURE';
};

export type AssetOperationalOccurrence = {
  id: string;
  serviceOrderId: string;
  orderNumber: string;
  occurrenceCode: string;
  description: string;
  recordedAt: string;
};

export type AssetOperationalLifecycle = {
  currentUse: AssetOperationalUsage | null;
  nextUse: AssetOperationalUsage | null;
  history: AssetOperationalUsage[];
  occurrences: AssetOperationalOccurrence[];
};
