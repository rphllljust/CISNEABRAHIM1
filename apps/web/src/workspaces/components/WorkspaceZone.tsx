import { useId, type ReactNode } from 'react';

/**
 * ZONA DE WORKSPACE — faixa estrutural de processo.
 *
 * Workspace enterprise nao e uma pilha de cards. A zona pertence a mesma area de trabalho e se
 * separa das demais por DIVISOR, nao por sombra/ring. Isso aumenta densidade e faz AGORA,
 * ATENCAO e CONTINUAR lerem como partes do mesmo processo.
 */
export function WorkspaceZone({
  title,
  note,
  action,
  children,
}: {
  title: string;
  /** Explica de onde vem o conteudo da zona. Nunca numero: a nota nao compete com o dado. */
  note?: ReactNode;
  /** Comando contextual da zona, sem criar command layer paralelo. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="cisne-divider--section mb-2 pb-2.5 last:mb-0"
    >
      <header className="mb-1.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="cisne-type-workspace m-0">
            {title}
          </h2>
          {note ? <p className="cisne-type-helper m-0 mt-0.5">{note}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
