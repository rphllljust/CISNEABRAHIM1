import { Link } from 'react-router-dom';
import type { WorkInboxPage } from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../workspaces/components/WorkspaceQueueSurface';

/**
 * RESUMO OPERACIONAL — padrão Operational Workspace (Dynamics 365).
 *
 * Somente fatos do GET /work-inbox. O total é do servidor; os dois subtotais
 * identificam explicitamente a página recebida, não o universo empresarial.
 * Nunca convertem ausência de publicação em contagem zero.
 */
export function OperationalActivitySummary({
  page,
  onExceptions,
  onOverdue,
}: {
  page: WorkInboxPage | null;
  onExceptions: () => void;
  onOverdue: () => void;
}) {
  if (!page) return null;

  const exceptionsOnPage = page.items.filter((item) => item.kind === 'EXCEPTION').length;
  const overdueOnPage = page.items.filter((item) => daysOverdue(item.dueAt) !== null).length;
  const partial = page.unavailableDomains.length > 0;

  return (
    <section className="ops-workspace-summary" aria-label="Resumo da fila operacional">
      <div className="ops-workspace-summary__heading">
        <p>WORKSPACE / EXECUÇÃO</p>
        <h2>Decisões e trabalho</h2>
        <span>Visão transacional da fila autorizada</span>
      </div>
      <div className="ops-workspace-summary__metrics">
        <Link className="ops-workspace-summary__metric" to="/app/work-inbox">
          <span className="ops-workspace-summary__name">Atividades na fila</span>
          <strong className="ops-workspace-summary__value tabular-nums">{page.total}</strong>
          <span className="ops-workspace-summary__detail">
            {partial ? 'Leitura parcial dos domínios' : 'Contagem publicada pelo servidor'}
          </span>
        </Link>
        <button className="ops-workspace-summary__metric" type="button" onClick={onExceptions}>
          <span className="ops-workspace-summary__name">Exceções nesta página</span>
          <strong className="ops-workspace-summary__value tabular-nums">{exceptionsOnPage}</strong>
          <span className="ops-workspace-summary__detail">Filtrar exceções da fila</span>
        </button>
        <button className="ops-workspace-summary__metric" type="button" onClick={onOverdue}>
          <span className="ops-workspace-summary__name">Atrasos nesta página</span>
          <strong className="ops-workspace-summary__value tabular-nums">{overdueOnPage}</strong>
          <span className="ops-workspace-summary__detail">Filtrar itens vencidos</span>
        </button>
      </div>
    </section>
  );
}
