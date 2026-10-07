import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** `md` = altura de controle de ERP; `lg` = alvo de toque (telas touch / acao de destaque). */
export type ButtonSize = 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-brand-600 bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:opacity-70',
  secondary:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-70',
  ghost:
    'border border-transparent bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-70',
  danger:
    'border border-red-700 bg-red-700 text-white hover:opacity-90 active:opacity-100 disabled:opacity-70',
};

/**
 * COMANDO PADRAO — altura de controle governada por token.
 *
 * Antes o botao tinha `min-h-[2.75rem]` (44px) sempre: alvo de TOQUE, herdado de guia mobile. Num
 * ERP operado por mouse e teclado por 8h, 44px de altura por comando engorda toolbar, action bar e
 * linha de comando — e a barra de acoes passa a empurrar a grade para fora da primeira dobra.
 *
 * Agora a altura vem de `--control-height` (30px), mantendo area de clique confortavel e foco
 * visivel. Controles que precisam de alvo maior (telas de toque) usam `size="lg"`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, loadingText, className, disabled, children, type = 'button', ...props },
  ref,
) {
  const isDisabled = disabled || loading;
  const accessibleName = typeof children === 'string' ? children : undefined;
  const loadingAriaLabel = loadingText
    ? `Carregando: ${loadingText.replace(/…$/, '')}`
    : `Carregando: ${accessibleName ?? 'ação'}`;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-label={loading ? loadingAriaLabel : accessibleName}
      className={cn(
        'cisne-type-action inline-flex items-center justify-center gap-1.5 rounded-md transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed',
        size === 'lg'
          ? 'min-h-[var(--spacing-touch)] px-3.5 py-2'
          : 'min-h-[var(--control-height)] px-2.5 py-1',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <span className="cisne-sr-only">{loadingText ?? 'Carregando'}</span>
          <span aria-hidden="true">{loadingText ?? '…'}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
