import type { UatScenarioId } from '../uat/uat-types';

export type SyntheticVerticalStopAfter =
  | 'prepared'
  | 'released'
  | 'completed_execution'
  | 'measurement_approved'
  | 'complete';

export type SyntheticScenarioFlow =
  | { kind: 'vertical'; uatScenarioId: UatScenarioId; stopAfter?: SyntheticVerticalStopAfter }
  | { kind: 'proposal_draft' }
  | { kind: 'proposal_issued' }
  | { kind: 'proposal_rejected' }
  | { kind: 'proposal_expired' }
  | { kind: 'purchase_order_cancelled' }
  | { kind: 'service_order_cancelled' }
  | { kind: 'client_inactive' }
  | { kind: 'measurement_pending' };

export type SyntheticBusinessScenario = {
  key: string;
  displayLabel: string;
  cnpjIndex: number;
  flow: SyntheticScenarioFlow;
};

export const SYNTHETIC_BUSINESS_SCENARIOS: SyntheticBusinessScenario[] = [
  {
    key: 'locacao-full',
    displayLabel: 'ALFA LOGÍSTICA TESTE LTDA — locação completa',
    cnpjIndex: 1001,
    flow: { kind: 'vertical', uatScenarioId: 'locacao', stopAfter: 'complete' },
  },
  {
    key: 'transporte-full',
    displayLabel: 'BETA SERVIÇOS INDUSTRIAIS TESTE LTDA — transporte completo',
    cnpjIndex: 1002,
    flow: { kind: 'vertical', uatScenarioId: 'transporte', stopAfter: 'complete' },
  },
  {
    key: 'obra-composto-full',
    displayLabel: 'Operação de Homologação — obra composta',
    cnpjIndex: 1003,
    flow: { kind: 'vertical', uatScenarioId: 'obra_composto', stopAfter: 'complete' },
  },
  {
    key: 'locacao-prepared',
    displayLabel: 'Cliente Logística Norte — OS em preparação',
    cnpjIndex: 1004,
    flow: { kind: 'vertical', uatScenarioId: 'locacao', stopAfter: 'prepared' },
  },
  {
    key: 'locacao-released',
    displayLabel: 'Cliente Logística Norte — OS liberada',
    cnpjIndex: 1005,
    flow: { kind: 'vertical', uatScenarioId: 'locacao', stopAfter: 'released' },
  },
  {
    key: 'transporte-exec-complete',
    displayLabel: 'Cliente Serviços Industriais — execução concluída',
    cnpjIndex: 1006,
    flow: { kind: 'vertical', uatScenarioId: 'transporte', stopAfter: 'completed_execution' },
  },
  {
    key: 'obra-measurement-approved',
    displayLabel: 'Operação de Homologação — medição aprovada',
    cnpjIndex: 1007,
    flow: { kind: 'vertical', uatScenarioId: 'obra_composto', stopAfter: 'measurement_approved' },
  },
  {
    key: 'proposta-elaboracao',
    displayLabel: 'Cliente Logística Norte — proposta em elaboração',
    cnpjIndex: 1008,
    flow: { kind: 'proposal_draft' },
  },
  {
    key: 'proposta-emitida',
    displayLabel: 'Cliente Serviços Industriais — proposta emitida',
    cnpjIndex: 1009,
    flow: { kind: 'proposal_issued' },
  },
  {
    key: 'proposta-rejeitada',
    displayLabel: 'Cliente Logística Norte — proposta rejeitada',
    cnpjIndex: 1010,
    flow: { kind: 'proposal_rejected' },
  },
  {
    key: 'proposta-expirada',
    displayLabel: 'Cliente Serviços Industriais — proposta expirada',
    cnpjIndex: 1011,
    flow: { kind: 'proposal_expired' },
  },
  {
    key: 'po-cancelado',
    displayLabel: 'Cliente Logística Norte — pedido cancelado',
    cnpjIndex: 1012,
    flow: { kind: 'purchase_order_cancelled' },
  },
  {
    key: 'os-cancelada',
    displayLabel: 'Cliente Serviços Industriais — OS cancelada',
    cnpjIndex: 1013,
    flow: { kind: 'service_order_cancelled' },
  },
  {
    key: 'cliente-inativo',
    displayLabel: 'Cliente Logística Norte — inativo',
    cnpjIndex: 1014,
    flow: { kind: 'client_inactive' },
  },
  {
    key: 'medicao-pendente',
    displayLabel: 'Operação de Homologação — medição pendente',
    cnpjIndex: 1015,
    flow: { kind: 'measurement_pending' },
  },
];

export function getSyntheticScenario(key: string): SyntheticBusinessScenario | undefined {
  return SYNTHETIC_BUSINESS_SCENARIOS.find((entry) => entry.key === key);
}
