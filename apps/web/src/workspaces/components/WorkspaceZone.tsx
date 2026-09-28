import { useId, type ReactNode } from 'react';

/**
 * ZONA DE WORKSPACE — moldura unica e densa.
 *
 * Um workspace de dominio responde tres perguntas, nesta ordem: o que exige decisao AGORA, o que
 * esta travado (ATENCAO) e onde continuar. Cada pergunta e uma zona com o mesmo peso visual, sem
 * cartao gigante, gradiente ou animacao: isto e tela de operacao, nao vitrine.
 *
 * O titulo da zona e o unico cabecalho de nivel 2 da secao; a moldura vem do proprio design
 * system (`rounded-lg bg-white shadow-sm ring-1 ring-gray-900/5`) para nao parecer de outra equipe.
 */
export function WorkspaceZone({
  title,
  note,
  children,
}: {
  title: string;
  /** Explica de onde vem o conteudo da zona. Nunca numero: a nota nao compete com o dado. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="mb-2 rounded-lg bg-white px-3 py-2.5 shadow-sm ring-1 ring-gray-900/5"
    >
      <header className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2
          id={headingId}
          className="m-0 text-[11px] font-semibold tracking-wider text-gray-500 uppercase"
        >
          {title}
        </h2>
        {note ? <p className="m-0 text-[11px] text-gray-500">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}
