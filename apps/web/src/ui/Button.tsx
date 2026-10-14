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

/**
 * VARIANTES DE COMANDO — CONTRATO DE COR DO ERP.
 *
 *   PRIMARY     bg #2563EB / hover #1D4ED8 / text #FFFFFF
 *   SECONDARY   bg #FFFFFF / border #D6DCE4 / text #0F172A
 *   TERTIARY    transparente
 *   DANGER      vermelho SOMENTE para comando destrutivo
 *
 * O primario era TEAL (`brand-600` #087f78). Isso colocava a COR DE IDENTIDADE do CISNE no papel de
 * ACAO: o botao mais importante da tela era verde-agua enquanto a informacao, o foco e a selecao
 * eram azuis — duas familias disputando o mesmo significado. Agora a acao primaria e o AZUL DE
 * INTERACAO, e o teal fica reservado ao ACCENT DE APOIO (contexto, relacao, identidade).
 *
 * O `danger` mantem vermelho cheio: e o unico comando que pode destruir dado, e a cor precisa ser
 * exclusiva dele. Se qualquer outro botao pudesse ser vermelho, o vermelho deixaria de avisar.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-[color:var(--color-blue-600)] bg-[color:var(--color-blue-600)] text-white hover:bg-[color:var(--color-blue-700)] hover:border-[color:var(--color-blue-700)] active:bg-[color:var(--color-blue-800)] disabled:opacity-70',
  secondary:
    'border border-[color:var(--color-border-strong)] bg-white text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-surface-hover)] active:bg-[color:var(--color-surface-sunken-soft)] disabled:opacity-70',
  ghost:
    'border border-transparent bg-transparent text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-hover)] hover:text-[color:var(--color-text-primary)] active:bg-[color:var(--color-surface-sunken-soft)] disabled:opacity-70',
  danger:
    'border border-[color:var(--color-critical-fg)] bg-[color:var(--color-critical-fg)] text-white hover:brightness-95 active:brightness-90 disabled:opacity-70',
};

/**
 * COMANDO PADRAO — altura de controle governada por token.
 *
 * Antes o botao tinha `min-h-[2.75rem]` (44px) sempre: alvo de TOQUE, herdado de guia mobile. Num
 * ERP operado por mouse e teclado por 8h, 44px de altura por comando engorda toolbar, action bar e
 * linha de comando — e a barra de acoes passa a empurrar a grade para fora da primeira dobra.
 *
 * Agora a altura vem de `--control-height` (34px) e o raio e 5px, conforme o contrato de controles.
 * Controles que precisam de alvo maior (telas de toque) usam `size="lg"`.
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
        'cisne-type-action inline-flex items-center justify-center gap-1.5 rounded-[5px] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-focus-ring)] disabled:cursor-not-allowed',
        size === 'lg'
          ? 'min-h-[var(--control-height-lg)] px-3.5 py-2'
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
