import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from './utils/cn';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'block min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-1.5 py-1 text-[length:var(--type-body-size)] text-text-primary ring-1 ring-border-control ring-inset outline-none focus:ring-2 focus:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-70',
        invalid && 'bg-critical-bg ring-critical-fg focus:ring-critical-fg',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
