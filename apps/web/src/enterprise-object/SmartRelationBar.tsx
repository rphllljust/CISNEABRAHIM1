import { Link } from 'react-router-dom';
import { cn } from '../ui/utils/cn';
import { toHumanText } from './human-text';
import type { SmartRelation, SmartRelationSpec } from './types';

/**
 * 5 — SMART RELATIONS
 *
 * Mostra as relacoes REAIS do objeto: solicitacoes, propostas, pedidos, OS, documentos,
 * recebiveis. Cada item leva a uma lista REALMENTE filtrada ou a um objeto real.
 *
 * REGRA DE AUTORIZACAO (vinculante): `read A != read B`.
 * Se o operador pode ver o cliente mas nao pode ver recebiveis, a linha de recebiveis
 * DESAPARECE por inteiro — sem count, sem rotulo cinza, sem a palavra "oculto".
 * A montagem autorizada acontece em `buildAuthorizedRelations`, e o componente apenas
 * renderiza o que recebeu: ele nao tem como vazar o que nao existe na entrada.
 *
 * REGRA DO NUMERO ORFAO: relacao sem destino real nao e renderizada. Um count que nao
 * navega e um count que mente.
 */

export type SmartRelationBarProps = {
  relations: SmartRelation[];
  title?: string;
  className?: string;
};

/**
 * Filtra as relacoes pela autorizacao real do operador.
 *
 * @param specs relacoes declaradas pela pagina, cada uma com `allowed` decidido por
 *              capability devolvida pelo backend.
 */
export function buildAuthorizedRelations(specs: SmartRelationSpec[]): SmartRelation[] {
  return specs
    .filter((spec) => spec.allowed)
    .filter((spec) => typeof spec.to === 'string' && spec.to.trim().length > 0)
    .filter((spec) => Number.isFinite(spec.count) && spec.count >= 0)
    .map(({ id, label, count, to, hint }) => ({ id, label, count, to, hint }));
}

export function SmartRelationBar({ relations, title = 'Relações', className }: SmartRelationBarProps) {
  const visible = relations
    .map((relation) => ({ ...relation, label: toHumanText(relation.label) ?? relation.label }))
    .filter((relation) => relation.label.length > 0 && relation.to.trim().length > 0);

  if (visible.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={title}
      className={cn('rounded-lg bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-900/5', className)}
    >
      <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0">
        {visible.map((relation) => (
          <li key={relation.id}>
            <Link
              to={relation.to}
              title={relation.hint}
              className="inline-flex items-baseline gap-1.5 text-sm text-gray-600 no-underline hover:text-brand-700"
            >
              <span>{relation.label}</span>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  relation.count === 0 ? 'text-gray-400' : 'text-gray-900',
                )}
              >
                {relation.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
