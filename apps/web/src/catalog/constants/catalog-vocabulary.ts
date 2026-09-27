export const OPERATIONAL_ARCHETYPES = [
  'RENTAL',
  'TRANSPORT',
  'CIVIL_WORK',
  'INSTALLATION',
  'MAINTENANCE',
  'INDUSTRIAL_SERVICE',
  'FACILITY_SERVICE',
  'COMMERCIAL_REPRESENTATION',
  'GOODS_TRADE',
  'LABOR_SERVICE',
  'WASTE_SERVICE',
  'MARITIME_SUPPORT',
] as const;

export const MEASUREMENT_MODES = ['BY_PERIOD', 'BY_QUANTITY', 'BY_EVENT', 'CHECKLIST'] as const;

export const MEASUREMENT_BASES = [
  'UNIT',
  'TIME',
  'DISTANCE',
  'VOLUME',
  'WEIGHT',
  'TRIP',
  'GLOBAL_COMPLETION',
] as const;

export const PRICING_MODEL_CODES = [
  'GLOBAL_PRICE',
  'UNIT_PRICE',
  'HOURLY',
  'DAILY',
  'MONTHLY',
  'PER_TRIP',
  'PER_KM',
  'PER_M3',
  'NEGOTIATED_PO_PRICE',
] as const;

export const EXECUTION_REQUIREMENT_TYPES = [
  'PHOTO',
  'DOCUMENT',
  'SIGNATURE',
  'START_TIME',
  'END_TIME',
  'LOCATION',
  'MILEAGE',
  'HOUR_METER',
  'QUANTITY',
  'WEIGHT',
  'VOLUME',
  'RECEIPT',
  'OBSERVATION',
] as const;

export const EXECUTION_CONDITION_TYPES = [
  'WHEN_MEASUREMENT_BASIS_IS',
  'WHEN_ARCHETYPE_IS',
  'WHEN_RESOURCE_TYPE_IS',
  'WHEN_LABOR_TYPE_IS',
] as const;

export const BILLING_ENTITLEMENT_POLICIES = [
  'MEASUREMENT_APPROVED',
  'FIXED_PRICE',
  'PERIODIC',
  'MILESTONE',
] as const;

/**
 * RÓTULOS HUMANOS do vocabulário do catálogo.
 *
 * O código continua sendo o VALOR (payload, persistência, API) — o que o operador lê é o rótulo.
 * Um select de ERP não pode exibir `BY_PERIOD`, `MEASUREMENT_APPROVED` ou `GLOBAL_COMPLETION`:
 * isso é nome de conceito interno. Os rótulos vivem aqui, em um só lugar, para todas as telas do
 * catálogo usarem os mesmos. Código sem rótulo registrado é exibido como está (nunca inventamos
 * vocabulário empresarial na tela).
 */
export const MEASUREMENT_MODE_LABELS: Record<string, string> = {
  BY_PERIOD: 'Por período',
  BY_QUANTITY: 'Por quantidade',
  BY_EVENT: 'Por evento',
  CHECKLIST: 'Checklist',
};

export const MEASUREMENT_BASIS_LABELS: Record<string, string> = {
  UNIT: 'Unidade',
  TIME: 'Tempo',
  DISTANCE: 'Distância',
  VOLUME: 'Volume',
  WEIGHT: 'Peso',
  TRIP: 'Viagem',
  GLOBAL_COMPLETION: 'Conclusão global',
};

export const BILLING_ENTITLEMENT_POLICY_LABELS: Record<string, string> = {
  MEASUREMENT_APPROVED: 'Após medição aprovada',
  FIXED_PRICE: 'Preço fixo',
  PERIODIC: 'Periódico',
  MILESTONE: 'Por marco de entrega',
};

export const PRICING_MODEL_LABELS: Record<string, string> = {
  GLOBAL_PRICE: 'Preço global',
  UNIT_PRICE: 'Preço por unidade',
  HOURLY: 'Por hora',
  DAILY: 'Diário',
  MONTHLY: 'Mensal',
  PER_TRIP: 'Por viagem',
  PER_KM: 'Por quilômetro',
  PER_M3: 'Por metro cúbico',
  NEGOTIATED_PO_PRICE: 'Preço negociado por ordem de compra',
};

export const REQUIREMENT_LEVEL_LABELS: Record<string, string> = {
  REQUIRED: 'Obrigatório',
  OPTIONAL: 'Opcional',
  CONDITIONAL: 'Condicional',
};

export const EXECUTION_REQUIREMENT_TYPE_LABELS: Record<string, string> = {
  PHOTO: 'Foto',
  DOCUMENT: 'Documento',
  SIGNATURE: 'Assinatura',
  START_TIME: 'Hora de início',
  END_TIME: 'Hora de término',
  LOCATION: 'Localização',
  MILEAGE: 'Quilometragem',
  HOUR_METER: 'Horímetro',
  QUANTITY: 'Quantidade',
  WEIGHT: 'Peso',
  VOLUME: 'Volume',
  RECEIPT: 'Recibo',
  OBSERVATION: 'Observação',
};

export const EXECUTION_CONDITION_TYPE_LABELS: Record<string, string> = {
  WHEN_MEASUREMENT_BASIS_IS: 'Quando a base de medição for',
  WHEN_ARCHETYPE_IS: 'Quando o arquétipo for',
  WHEN_RESOURCE_TYPE_IS: 'Quando o tipo de recurso for',
  WHEN_LABOR_TYPE_IS: 'Quando a função for',
};

/**
 * Rótulo humano de um código de vocabulário. Sem rótulo registrado o próprio código é exibido:
 * a tela nunca inventa um termo empresarial que o registro não confirme.
 */
export function vocabularyLabel(labels: Record<string, string>, code: string): string {
  return labels[code] ?? code;
}

export const ARCHETYPE_LABELS: Record<string, string> = {
  RENTAL: 'Locação',
  TRANSPORT: 'Transporte',
  CIVIL_WORK: 'Obra civil',
  INSTALLATION: 'Instalação',
  MAINTENANCE: 'Manutenção',
  INDUSTRIAL_SERVICE: 'Serviço industrial',
  FACILITY_SERVICE: 'Facility services',
  COMMERCIAL_REPRESENTATION: 'Representação comercial',
  GOODS_TRADE: 'Comércio de bens',
  LABOR_SERVICE: 'Mão de obra',
  WASTE_SERVICE: 'Resíduos',
  MARITIME_SUPPORT: 'Apoio marítimo',
};
