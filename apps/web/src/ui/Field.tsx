import { useId, type ReactNode } from 'react';
import { cn } from './utils/cn';
import { FieldError } from './FieldError';

export type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    /*
      CAMPO — rotulo, ajuda, controle e erro na MESMA celula, com gaps governados.

      Antes: `gap-1.5` no container + `mb-1.5` no rotulo. A soma dos dois afastava o rotulo do
      proprio controle, e num formulario de 20 campos isso vira ~60px de espaco morto — exatamente
      o "margem decorativa" que a densidade enterprise elimina. Agora o gap e unico e o rotulo fica
      colado ao controle que ele nomeia.
    */
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <label htmlFor={fieldId} className="cisne-meta-label block">
        {label}
        {required ? (
          <span className="text-error-fg" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="cisne-sr-only"> (obrigatório)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="cisne-type-helper m-0">
          {hint}
        </p>
      ) : null}
      <div aria-describedby={describedBy}>{children}</div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
