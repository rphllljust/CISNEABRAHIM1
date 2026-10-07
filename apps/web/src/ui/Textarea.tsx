import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from './utils/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, readOnly, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      className={cn(
        'block min-h-[4.5rem] w-full resize-y rounded-md border-0 bg-white px-1.5 py-1 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-70 read-only:bg-gray-50',
        invalid && 'bg-red-50 ring-red-500/30',
        className,
      )}
      {...props}
    />
  );
});
