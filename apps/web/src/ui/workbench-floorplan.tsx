import type { ReactNode } from 'react';
import { cn } from './utils/cn';

/**
 * FLOORPLAN DE WORKBENCH — ENTERPRISE TIER 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE COMPONENTE EXISTE
 *
 * O CISNE já tem a gramática de FILA (`ui/workbench.tsx`) e a de LISTA
 * (`ui/enterprise-list.tsx`). O que faltava era a moldura do padŕão de trabalho
 * COMPLEXO — a que o plano diretor define como:
 *
 *   WORK QUEUE  →  ACTIVE WORK  →  CONTEXT
 *
 * Uma exceção contábil não se resolve olhando uma lista: o operador escolhe o caso na
 * fila, lê o estado real do caso no centro e decide no contexto à direita. Sem essa
 * moldura, cada tela reinventa um arranjo de colunas — que é exatamente a
 * fragmentação que o padrão evita.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ELE **NÃO** FAZ
 *
 * - Não busca dado, não decide estado e não conhece domínio. É composição pura.
 * - Não substitui `WorkbenchQueue`: a coluna esquerda RECEBE uma fila feita com ele.
 * - Não é obrigatório: o plano é explícito em que nem toda página usa três colunas.
 *   Só use quando o trabalho exige escolher → ler → decidir sem perder o lugar.
 */

export function WorkbenchFloorplan({
  queue,
  active,
  context,
  queueLabel,
  activeLabel,
  contextLabel,
}: {
  /** Coluna de trabalho: a fila de decisão (ex.: `WorkbenchQueue`). */
  queue: ReactNode;
  /** Coluna central: o caso ativo, com estado real e fatos. */
  active: ReactNode;
  /** Coluna de contexto: causa, impacto, próximo passo e comandos. */
  context?: ReactNode;
  queueLabel?: string;
  activeLabel?: string;
  contextLabel?: string;
}) {
  return (
    <div
      data-region="workbench-floorplan"
      className={cn(
        'grid gap-2 px-2 pb-2',
        // Duas colunas quando não há contexto; três quando há.
        context ? 'lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)_minmax(280px,360px)]' : 'lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]',
        'grid-cols-1',
      )}
    >
      <section aria-label={queueLabel ?? 'Fila de trabalho'} className="min-w-0">
        {queue}
      </section>
      <section aria-label={activeLabel ?? 'Trabalho ativo'} className="min-w-0">
        {active}
      </section>
      {context ? (
        <section aria-label={contextLabel ?? 'Contexto da decisão'} className="min-w-0">
          {context}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Bloco de contexto: título pequeno + conteúdo. Reaproveitado pelas colunas central e
 * direita para que "estado real", "causa" e "próxima ação" tenham a MESMA moldura.
 */
export function ContextBlock({
  title,
  children,
  tone = 'default',
}: {
  title: string;
  children: ReactNode;
  tone?: 'default' | 'critical' | 'warning';
}) {
  const toneClass = {
    default: 'border-[color:var(--color-border-default)] bg-white',
    critical: 'border-red-300 bg-red-50',
    warning: 'border-amber-300 bg-amber-50',
  }[tone];

  return (
    <div className={cn('mb-2 overflow-hidden rounded-[10px] border', toneClass)}>
      <h2 className="cisne-type-workspace m-0 border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-3 py-1.5">
        {title}
      </h2>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

/** Par rótulo/valor de contexto. Não formata número: só apresenta o que veio. */
export function ContextFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="cisne-meta-label m-0">{label}</dt>
      <dd className="m-0 text-xs font-medium">{value}</dd>
    </div>
  );
}
