import {
  SERVICE_ORDER_ACTIVE_STATUS,
  SERVICE_ORDER_LIST_EVENTS,
  SERVICE_ORDER_LIST_FILTERS,
  SERVICE_ORDER_LIST_ORDERS,
  type ServiceOrderListEvent,
  type ServiceOrderListFilter,
  type ServiceOrderListOrder,
} from '../types/service-order-list.types';
import type { ServiceOrderStatus } from '../types/service-order.types';

export type ServiceOrderListParams = {
  q: string;
  status: '' | ServiceOrderStatus | typeof SERVICE_ORDER_ACTIVE_STATUS;
  filter: '' | ServiceOrderListFilter;
  order: '' | ServiceOrderListOrder;
  unitId: string;
  clientId: string;
  from: string;
  to: string;
  event: '' | ServiceOrderListEvent;
};

export const EMPTY_SERVICE_ORDER_LIST_PARAMS: ServiceOrderListParams = {
  q: '',
  status: '',
  filter: '',
  order: '',
  unitId: '',
  clientId: '',
  from: '',
  to: '',
  event: '',
};

export function parseServiceOrderListParams(
  searchParams: URLSearchParams,
): ServiceOrderListParams {
  const statusRaw = searchParams.get('status') ?? '';
  const filterRaw = searchParams.get('filter') ?? '';
  const orderRaw = searchParams.get('order') ?? '';
  const eventRaw = searchParams.get('event') ?? '';

  return {
    q: searchParams.get('q') ?? '',
    status:
      statusRaw === SERVICE_ORDER_ACTIVE_STATUS ||
      statusRaw === '' ||
      isServiceOrderStatusParam(statusRaw)
        ? statusRaw
        : '',
    filter: isServiceOrderListFilter(filterRaw) ? filterRaw : '',
    order: isServiceOrderListOrder(orderRaw) ? orderRaw : '',
    unitId: searchParams.get('unitId') ?? '',
    clientId: searchParams.get('clientId') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    event: isServiceOrderListEvent(eventRaw) ? eventRaw : '',
  };
}

export function buildServiceOrderListSearchParams(
  params: ServiceOrderListParams,
  offset = 0,
): URLSearchParams {
  const search = new URLSearchParams();
  if (params.q.trim()) {
    search.set('q', params.q.trim());
  }
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.filter) {
    search.set('filter', params.filter);
  }
  if (params.order) {
    search.set('order', params.order);
  }
  if (params.unitId.trim()) {
    search.set('unitId', params.unitId.trim());
  }
  if (params.clientId.trim()) {
    search.set('clientId', params.clientId.trim());
  }
  if (params.from.trim()) {
    search.set('from', params.from.trim());
  }
  if (params.to.trim()) {
    search.set('to', params.to.trim());
  }
  if (params.event) {
    search.set('event', params.event);
  }
  if (offset > 0) {
    search.set('offset', String(offset));
  }
  return search;
}

export function buildServiceOrdersListHref(params: Partial<ServiceOrderListParams>): string {
  const search = buildServiceOrderListSearchParams({
    ...EMPTY_SERVICE_ORDER_LIST_PARAMS,
    ...params,
  });
  const qs = search.toString();
  return qs ? `/app/service-orders?${qs}` : '/app/service-orders';
}

function isServiceOrderStatusParam(value: string): value is ServiceOrderStatus {
  return [
    'DRAFT',
    'PREPARED',
    'RELEASED',
    'IN_EXECUTION',
    'PAUSED',
    'COMPLETED',
    'CANCELLED',
  ].includes(value);
}

function isServiceOrderListFilter(value: string): value is ServiceOrderListFilter {
  return (Object.values(SERVICE_ORDER_LIST_FILTERS) as string[]).includes(value);
}

function isServiceOrderListEvent(value: string): value is ServiceOrderListEvent {
  return value === SERVICE_ORDER_LIST_EVENTS.Opened || value === SERVICE_ORDER_LIST_EVENTS.Completed;
}

function isServiceOrderListOrder(value: string): value is ServiceOrderListOrder {
  return (Object.values(SERVICE_ORDER_LIST_ORDERS) as string[]).includes(value);
}
