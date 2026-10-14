import { useId, type ReactNode } from 'react';
import { cn } from './utils/cn';

export type TabItem = {
  id: string;
  label: string;
  panel: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
};

export function Tabs({ items, activeId, onChange, label, className }: TabsProps) {
  const baseId = useId();

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex flex-wrap gap-3 border-b border-border-subtle"
      >
        {items.map((item) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-${item.id}-tab`}
              aria-selected={selected}
              aria-controls={`${baseId}-${item.id}-panel`}
              disabled={item.disabled}
              className={cn(
                'relative min-h-[var(--tab-height)] border-b-2 px-1 text-sm font-medium transition-colors focus-visible:cisne-focus-ring disabled:cursor-not-allowed disabled:opacity-60',
                selected
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => {
        const selected = item.id === activeId;
        return (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-${item.id}-panel`}
            aria-labelledby={`${baseId}-${item.id}-tab`}
            hidden={!selected}
            className="py-4"
          >
            {selected ? item.panel : null}
          </div>
        );
      })}
    </div>
  );
}
