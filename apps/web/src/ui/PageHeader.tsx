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
 * CABECALHO DE SUPERFICIE — a identidade COMPACTA da funcao, nao o titulo do registro.
 *
 * Antes: `mb-5` + `text-2xl` + `mt-2` + `mt-3`. O titulo de 24px com tres niveis de margem consumia
 * ~110px da primeira dobra antes de qualquer dado — num ERP isso e caro, porque a primeira dobra e
 * onde o operador le a fila.
 *
 * FOUNDATION: o cabecalho passa a ser a FAIXA DE IDENTIDADE DO WORKSPACE — identidade + escopo (a
 * descricao, que diz QUAL recorte esta aberto) + comandos, tudo na mesma faixa vertical, separada
 * do resto por REGUA DE SECAO em vez de por respiro. Duas consequencias deliberadas:
 *
 *   - `mb-0`: a fronteira e a regua, nao a margem. Margem e decorativa; a regua e hierarquia.
 *   - a descricao continua sendo ESCOPO, nunca texto institucional. Ela explica o recorte da fila,
 *     nao vende a tela.
 */
export function PageHeader({ eyebrow, title, description, meta, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'cisne-divider--section flex flex-wrap items-start justify-between gap-x-4 gap-y-1 pb-1.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="cisne-section-title m-0 mb-0.5">{eyebrow}</p> : null}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h1 className="cisne-type-workspace m-0">{title}</h1>
          {meta ? <div className="cisne-type-meta">{meta}</div> : null}
        </div>
        {description ? (
          <p className="cisne-type-helper m-0 mt-0.5 max-w-3xl">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}
