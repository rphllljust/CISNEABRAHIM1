import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './utils/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

/**
 * CONTROLE DE ENTRADA — altura governada por `--control-height`.
 *
 * Antes: `py-2 px-3` sem altura declarada, o que produzia ~38px por campo. Numa barra de filtros de
 * 6 campos isso e meia linha de grade perdida, e no formulario empurra a action bar para fora da
 * primeira dobra. A altura agora vem do token de densidade e nao de padding adivinhado por tela.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, readOnly, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      className={cn(
        'block min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-2 py-1 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-70',
        invalid && 'bg-red-50 ring-red-500/30',
        className,
      )}
      {...props}
    />
  );
});
