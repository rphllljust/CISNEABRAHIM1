import type { ReactNode } from 'react';
import { cn } from './utils/cn';

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/**
 * ESTADO VAZIO COMPACTO — nao um cartao de 300px para dizer "nenhum registro".
 *
 * A versao anterior era `px-6 py-10 text-center` com `cisne-type-section-title`: um bloco alto,
 * centralizado, com titulo grande, que ocupava a area de uma grade inteira e EMPURRAVA a
 * interface para baixo sem conduzir o operador. Em 38 superficies isso virava a experiencia
 * padrao de quem abre um modulo ainda sem dado.
 *
 * Agora o vazio e uma faixa densa, alinhada a esquerda, na mesma linguagem das worklists: diz o
 * que aconteceu, explica o motivo quando ha um, e oferece a acao REAL quando ela existe. Sem
 * acao e sem motivo, ele nao inventa texto nem altura — so declara o fato.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-dashed border-border-default bg-surface-raised px-3 py-2.5',
        className,
      )}
    >
      <div className="min-w-0">
        {/*
          O titulo continua sendo HEADING de verdade: o vazio e uma secao da pagina e o leitor de
          tela precisa poder navegar ate ele. A densidade vem do tamanho da fonte e do espaco,
          nao de rebaixar a semantica para um paragrafo.
        */}
        <h2 className="m-0 text-[13px] font-semibold text-gray-900">{title}</h2>
        {description ? (
          <p className="m-0 mt-0.5 text-xs text-gray-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
