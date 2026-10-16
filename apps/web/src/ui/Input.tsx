import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './utils/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

/**
 * CONTROLE DE ENTRADA — altura e raio governados por token.
 *
 * CONTRATO: input height 34px, radius 5px.
 *
 * Antes: `py-2 px-3` sem altura declarada, o que produzia ~38px por campo. Numa barra de filtros de
 * 6 campos isso e meia linha de grade perdida, e no formulario empurra a action bar para fora da
 * primeira dobra. A altura agora vem do token de densidade e nao de padding adivinhado por tela.
 *
 * A BORDA usa `--color-border-strong` (#D6DCE4) em vez de `ring-gray-300`: o campo precisa ser
 * visivelmente um CONTROLE dentro da superficie branca, e o cinza `gray-300` do Tailwind nao pertence
 * a familia de bordas do produto.
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
        'block min-h-[var(--control-height)] w-full rounded-[5px] border border-[color:var(--color-border-control)] bg-white px-2.5 py-1 text-[length:var(--type-body-size)] text-[color:var(--color-text-primary)] outline-none focus:border-[color:var(--color-focus-ring)] focus:ring-2 focus:ring-[color:var(--color-focus-ring-soft)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-sunken)] disabled:text-[color:var(--color-text-disabled)]',
        invalid && 'border-[color:var(--color-critical-fg)] focus:border-[color:var(--color-critical-fg)] focus:ring-[color:var(--color-critical-border)]',
        className,
      )}
      {...props}
    />
  );
});
