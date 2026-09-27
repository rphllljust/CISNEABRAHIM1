import { Badge, type BadgeTone } from '../../ui/Badge';
import type { ServiceOrderStatus } from '../types/service-order.types';
import { formatServiceOrderStatus } from '../utils/service-order-labels';

type ServiceOrderStatusBadgeProps = {
  status: ServiceOrderStatus;
};

/**
 * Tom visual por status real da OS. Exportado para que outras superficies do mesmo objeto
 * (cabecalho da object page) representem o MESMO status com o MESMO tom, sem mapa paralelo.
 */
export const SERVICE_ORDER_STATUS_TONES: Record<ServiceOrderStatus, BadgeTone> = {
  DRAFT: 'neutral',
  PREPARED: 'info',
  RELEASED: 'info',
  IN_EXECUTION: 'success',
  PAUSED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'error',
};

export function ServiceOrderStatusBadge({ status }: ServiceOrderStatusBadgeProps) {
  const label = formatServiceOrderStatus(status);
  return (
    <Badge tone={SERVICE_ORDER_STATUS_TONES[status]} aria-label={`Status: ${label}`}>
      {label}
    </Badge>
  );
}
