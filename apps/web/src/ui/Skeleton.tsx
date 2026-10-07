import { cn } from './utils/cn';

/*
 * SKELETON — LOADING LOCALIZADO, na forma do que vai chegar.
 *
 * REGRA VINCULANTE: skeleton existe para a regiao que esta carregando, nunca para a aplicacao
 * inteira. A shell, a navegacao e as regioes ja resolvidas continuam utilizaveis enquanto isto
 * aparece — derrubar a tela toda porque uma chamada esta pendente e o anti-padrao que esta
 * foundation elimina.
 *
 * A forma tambem importa: um skeleton de grade com LINHAS na altura real da linha evita o salto de
 * layout (layout shift) quando o dado chega. Um bloco generico de `h-4` mente sobre o que vem e
 * empurra a pagina quando e substituido.
 */

export type SkeletonProps = {
  className?: string;
  lines?: number;
};

export function Skeleton({ className, lines = 1 }: SkeletonProps) {
  if (lines <= 1) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'h-3 animate-pulse rounded-[var(--radius-sm)] bg-gray-200/80',
          className,
        )}
      />
    );
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="h-3 animate-pulse rounded-[var(--radius-sm)] bg-gray-200/80"
          /* Larguras decrescentes: le como texto, nao como barras iguais. */
          style={{ width: `${100 - (index % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

/**
 * SKELETON DE GRADE — a forma da worklist enquanto a fila carrega.
 *
 * Renderiza `rows` linhas na altura REAL da linha (`--row-height`) e com colunas falsas, para que
 * a grade nao salte quando o dado real substituir o placeholder. `aria-hidden` porque o estado e
 * anunciado pelo container com `role="status"` — nao por cada barra cinza.
 */
export function SkeletonTable({
  rows = 8,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)} aria-hidden="true" data-testid="skeleton-table">
      <div className="flex items-center gap-2 border-b border-gray-300 py-1">
        {Array.from({ length: columns }, (_, index) => (
          <div
            key={`head-${index}`}
            className="h-3 animate-pulse rounded-[var(--radius-sm)] bg-gray-300/80"
            style={{ width: index === 0 ? '18%' : `${Math.max(8, 62 / columns)}%` }}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="flex items-center gap-2 border-b border-gray-100"
          style={{ height: 'var(--row-height)' }}
        >
          {Array.from({ length: columns }, (_, colIndex) => (
            <div
              key={`cell-${rowIndex}-${colIndex}`}
              className="h-2.5 animate-pulse rounded-[var(--radius-sm)] bg-gray-200/80"
              style={{ width: colIndex === 0 ? '18%' : `${Math.max(8, 62 / columns)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * SKELETON DE FORMULARIO — campos falsos na altura real do controle.
 *
 * Mantem a mesma grade do formulario real (rotulo em cima, controle abaixo) para que o operador veja
 * a FORMA do que vai chegar e nao um bloco cinza generico.
 */
export function SkeletonForm({
  fields = 6,
  className,
}: {
  fields?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-x-4 gap-y-2 sm:grid-cols-2', className)} aria-hidden="true" data-testid="skeleton-form">
      {Array.from({ length: fields }, (_, index) => (
        <div key={`field-${index}`} className="flex flex-col gap-0.5">
          <div className="h-2.5 w-24 animate-pulse rounded-[var(--radius-sm)] bg-gray-200/80" />
          <div
            className="w-full animate-pulse rounded-md bg-gray-100"
            style={{ height: 'var(--control-height)' }}
          />
        </div>
      ))}
    </div>
  );
}
