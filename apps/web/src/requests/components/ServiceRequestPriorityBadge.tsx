import { cn } from '../../ui/utils/cn';
import {
  SERVICE_REQUEST_PRIORITIES,
  type ServiceRequestPriority,
} from '../types/service-request.types';
import { formatServiceRequestPriority } from '../utils/service-request-labels';

type ServiceRequestPriorityBadgeProps = {
  priority: ServiceRequestPriority | null;
  className?: string;
};

const PRIORITY_CLASS: Record<ServiceRequestPriority, string> = {
  [SERVICE_REQUEST_PRIORITIES.Urgent]: 'bg-red-50 text-red-700 ring-red-600/20',
  [SERVICE_REQUEST_PRIORITIES.High]: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  [SERVICE_REQUEST_PRIORITIES.Normal]: 'bg-gray-50 text-gray-700 ring-gray-500/20',
  [SERVICE_REQUEST_PRIORITIES.Low]: 'bg-gray-50 text-gray-500 ring-gray-400/20',
};

export function ServiceRequestPriorityBadge({
  priority,
  className,
}: ServiceRequestPriorityBadgeProps) {
  const label = formatServiceRequestPriority(priority);
  const tone = priority ? PRIORITY_CLASS[priority] : 'bg-white text-gray-400 ring-gray-300/40';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-inset',
        tone,
        className,
      )}
      aria-label={`Prioridade: ${label}`}
    >
      {label}
    </span>
  );
}
