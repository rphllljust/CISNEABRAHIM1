import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './utils/cn';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'h-5 w-5 rounded-[var(--radius-sm)] border border-border-control accent-cisne-action text-cisne-action focus-visible:cisne-focus-ring disabled:cursor-not-allowed disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
});
