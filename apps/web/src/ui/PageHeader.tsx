import type { ReactNode } from 'react';
import { cn } from './utils/cn';

export type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * CABECALHO DE SUPERFICIE — o titulo da FUNCAO, nao do registro.
 *
 * Antes: `mb-5` + `text-2xl` + `mt-2` + `mt-3`. O titulo de 24px com tres niveis de margem consumia
 * ~110px da primeira dobra antes de qualquer dado — num ERP isso e caro, porque a primeira dobra e
 * onde o operador le a fila.
 *
 * Agora: tipografia governada por papel (`cisne-type-workspace`), espacamento reduzido e a linha de
 * metadados na mesma faixa do titulo. O cabecalho continua dizendo "onde estou", mas ocupa menos.
 */
export function PageHeader({ eyebrow, title, description, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('cisne-divider mb-2 flex flex-wrap items-start justify-between gap-3 pb-2', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="cisne-section-title m-0 mb-0.5">{eyebrow}</p> : null}
        <h1 className="cisne-type-workspace m-0">{title}</h1>
        {description ? (
          <p className="cisne-type-helper m-0 mt-0.5 max-w-3xl">{description}</p>
        ) : null}
        {meta ? <div className="cisne-type-meta mt-1">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}
