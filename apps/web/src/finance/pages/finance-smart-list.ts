import {
  AGING_BUCKET_LABELS,
  RECEIVABLE_STATUS_LABELS,
  PAYABLE_STATUS_LABELS,
} from '../../financial-ui/labels';
import type { BuiltInView, SmartListAllowedFilters } from '../../operator';

/**
 * Definições de visão das listas financeiras.
 *
 * Tudo aqui é derivado de campos REAIS do payload (`status`, `dueDate`,
 * `remainingBalance`, `agingBucket`). Nenhum status é inventado e nenhuma
 * regra financeira é criada: a tela apenas recorta o que o servidor já
 * autorizou. A vista não recalcula título, saldo nem aging.
 */

const RECEIVABLE_STATUS_VALUES = Object.keys(RECEIVABLE_STATUS_LABELS);
const PAYABLE_STATUS_VALUES = Object.keys(PAYABLE_STATUS_LABELS);
const AGING_BUCKET_VALUES = Object.keys(AGING_BUCKET_LABELS);

/** Visões de sistema de contas a receber. */
export const RECEIVABLES_BUILT_IN_VIEWS: BuiltInView[] = [
  {
    id: 'sys.receivables.overdue',
    name: 'Vencidos',
    description: 'Títulos com status Vencido',
    config: {
      filters: { status: 'OVERDUE' },
      sortKey: 'dueDate',
      sortDirection: 'asc',
      groupKey: null,
    },
  },
  {
    id: 'sys.receivables.open',
    name: 'A vencer',
    description: 'Títulos em aberto, ainda não recebidos',
    config: { filters: { status: 'OPEN' }, sortKey: 'dueDate', sortDirection: 'asc', groupKey: null },
  },
  {
    id: 'sys.receivables.partial',
    name: 'Parciais',
    description: 'Títulos parcialmente recebidos',
    config: {
      filters: { status: 'PARTIALLY_PAID' },
      sortKey: 'dueDate',
      sortDirection: 'asc',
      groupKey: null,
    },
  },
  {
    id: 'sys.receivables.settled',
    name: 'Recebidos',
    description: 'Títulos já recebidos',
    config: { filters: { status: 'PAID' }, sortKey: 'dueDate', sortDirection: 'desc', groupKey: null },
  },
];

/** Visões de sistema de contas a pagar. */
export const PAYABLES_BUILT_IN_VIEWS: BuiltInView[] = [
  {
    id: 'sys.payables.overdue',
    name: 'Vencidos',
    description: 'Títulos com status Vencido',
    config: {
      filters: { status: 'OVERDUE' },
      sortKey: 'dueDate',
      sortDirection: 'asc',
      groupKey: null,
    },
  },
  {
    id: 'sys.payables.open',
    name: 'A vencer',
    description: 'Títulos em aberto, ainda não pagos',
    config: { filters: { status: 'OPEN' }, sortKey: 'dueDate', sortDirection: 'asc', groupKey: null },
  },
  {
    id: 'sys.payables.partial',
    name: 'Parciais',
    description: 'Títulos parcialmente pagos',
    config: {
      filters: { status: 'PARTIALLY_PAID' },
      sortKey: 'dueDate',
      sortDirection: 'asc',
      groupKey: null,
    },
  },
  {
    id: 'sys.payables.settled',
    name: 'Pagos',
    description: 'Títulos já pagos',
    config: { filters: { status: 'PAID' }, sortKey: 'dueDate', sortDirection: 'desc', groupKey: null },
  },
  {
    id: 'sys.payables.aging90',
    name: 'Aging 90+',
    description: 'Títulos no balde de atraso mais de 90 dias',
    config: {
      filters: { agingBucket: '90_PLUS' },
      sortKey: 'dueDate',
      sortDirection: 'asc',
      groupKey: null,
    },
  },
];

/**
 * Allow-list de persistência. É a defesa principal: só valor que é opção real de
 * um filtro declarado entra em visão salva — um nome de cliente nunca entra.
 */
export const RECEIVABLES_ALLOWED_FILTERS: SmartListAllowedFilters = {
  filters: { status: RECEIVABLE_STATUS_VALUES },
  sortKeys: ['externalReference', 'dueDate', 'status', 'principal', 'remainingBalance'],
};

export const PAYABLES_ALLOWED_FILTERS: SmartListAllowedFilters = {
  filters: { status: PAYABLE_STATUS_VALUES, agingBucket: AGING_BUCKET_VALUES },
  sortKeys: [
    'externalReference',
    'dueDate',
    'status',
    'agingBucket',
    'principal',
    'remainingBalance',
  ],
};

/** Acima de quantos dias um título é tratado como "vencendo" na visão da semana. */
export const DUE_SOON_DAYS = 7;
