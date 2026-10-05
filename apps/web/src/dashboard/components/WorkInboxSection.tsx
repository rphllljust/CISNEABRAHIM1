import { WorkbenchQueue, workbenchPrimaryActionClass } from '../../ui/workbench';
import {
  WORK_DOMAIN_LABELS,
  WORK_KIND_LABELS,
  type WorkInboxPage,
  type WorkItem,
} from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../work-inbox/pages/WorkInboxPage';

/**
 * FILA EXECUTIVA DE TRABALHO — o trabalho real de todos os dominios, na primeira dobra.
 *
 * Esta secao NAO tem barra de filtros propria. O recorte de dominio e o "somente vencidos" vivem
 * em UM unico lugar da tela (a faixa de recorte do cabecalho) e CHEGAM AQUI POR PROPS, derivadas
 * da URL do painel: "Todos" daqui e "Tudo" do painel eram a mesma pergunta feita duas vezes, com
 * dois estados que podiam discordar.
 *
 * A selecao tambem nao e local: o item escolhido sobe para o painel, que o entrega ao
 * `ContextDrawer`. Um unico caminho de contexto para fila, excecao e estagio.
 *
 * Consome o MESMO read model `GET /work-inbox` (filtro server-side real, feito pelo painel).
 * Atraso vem do `dueAt` persistido; ausencia de `dueAt` nao e atraso.
 */

export function WorkInboxSection({
  page,
  phase,
  selectedId,
  onSelect,
  onOpenRoute,
}: {
  page: WorkInboxPage | null;
  phase: 'loading' | 'ready' | 'denied' | 'error';
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onOpenRoute: (route: string) => void;
}) {
  if (phase === 'denied' || phase === 'error') {
    return null;
  }

  const items = page?.items ?? [];

  return (
    <WorkbenchQueue
      title="Minha fila"
      count={page?.total ?? null}
      emptyTitle="Nenhum trabalho real neste recorte."
      emptyDescription="A fila não inventa pendência para parecer cheia."
    >
      {items.map((item) => {
        const late = daysOverdue(item.dueAt);
        const isSelected = selectedId === item.id;
        return (
          /* LINHA UNICA DE TRABALHO: aging -> objeto -> vencimento -> acao. O motivo fica ABAIXO
             como metadata secundaria, para o item caber em uma faixa densa em vez de 4 linhas. */
          <article
            key={item.id}
            className={`dashboard-queue-item${isSelected ? ' dashboard-queue-item--selected' : ''}${
              late !== null ? ' dashboard-queue-item--critical' : ''
            }`}
          >
            <span className="dashboard-queue-item__aging tabular-nums">
              {late !== null ? (
                <>
                  <strong>{late}</strong>
                  <span>{late === 1 ? 'dia' : 'dias'}</span>
                </>
              ) : (
                <span className="dashboard-queue-item__ontrack">em dia</span>
              )}
            </span>

            <button
              type="button"
              className="dashboard-queue-item__object"
              onClick={() => onSelect(item)}
              title="Ver o contexto deste trabalho"
            >
              <span className="dashboard-queue-item__ref">{item.businessReference}</span>
              <span className="dashboard-queue-item__title">{item.title}</span>
            </button>

            <span className="dashboard-queue-item__due tabular-nums">
              {item.dueAt ? new Date(item.dueAt).toLocaleDateString('pt-BR') : 'Sem prazo'}
            </span>

            <button
              type="button"
              className={workbenchPrimaryActionClass}
              onClick={() => onOpenRoute(item.targetRoute)}
            >
              {item.actionLabel}
            </button>

            {/* METADATA SECUNDARIA — dominio, natureza e motivo, sem competir com a linha. */}
            <p className="dashboard-queue-item__meta">
              <span>{WORK_DOMAIN_LABELS[item.domain]}</span>
              <span aria-hidden>·</span>
              <span>{WORK_KIND_LABELS[item.kind]}</span>
              <span aria-hidden>·</span>
              <span className="dashboard-queue-item__reason">{item.reason}</span>
            </p>
          </article>
        );
      })}
    </WorkbenchQueue>
  );
}
