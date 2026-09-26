export const SERVICE_ORDER_LIST_FILTERS = {
  Overdue: 'overdue',
  ApproachingDue: 'approaching-due',
  Mine: 'mine',
  Unassigned: 'unassigned',
  Unscheduled: 'unscheduled',
  ScheduledToday: 'scheduled-today',
} as const;

export type ServiceOrderListFilter =
  (typeof SERVICE_ORDER_LIST_FILTERS)[keyof typeof SERVICE_ORDER_LIST_FILTERS];

export const SERVICE_ORDER_LIST_EVENTS = {
  Opened: 'opened',
  Completed: 'completed',
} as const;

export type ServiceOrderListEvent =
  (typeof SERVICE_ORDER_LIST_EVENTS)[keyof typeof SERVICE_ORDER_LIST_EVENTS];

export const SERVICE_ORDER_ACTIVE_STATUS = 'active';

export const SERVICE_ORDER_LIST_ORDERS = {
  Recent: 'recent',
  Schedule: 'schedule',
} as const;

export type ServiceOrderListOrder =
  (typeof SERVICE_ORDER_LIST_ORDERS)[keyof typeof SERVICE_ORDER_LIST_ORDERS];
