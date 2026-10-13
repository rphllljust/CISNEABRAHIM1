import {
  WorkbenchQueue,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import {
  WORK_DOMAIN_LABELS,
  WORK_KIND_LABELS,
  type WorkInboxPage,
  type WorkItem,
} from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../workspaces/components/WorkspaceQueueSurface';

/**
 * MINHA FILA — a AREA CENTRAL do workspace, e nao mais um bloco secundario.
 *
 * Esta secao NAO tem barra de filtros propria. O recorte de dominio e o "somente vencidos" vivem em
 * UM unico lugar da tela (a faixa de recorte do cabecalho) e CHEGAM AQUI POR PROPS, derivadas da URL
 * do workspace: "Todos" daqui e "Tudo" do painel eram a mesma pergunta feita duas vezes, com dois
 * estados que podiam discordar.
 *
 * A selecao tambem nao e local: o item escolhido sobe para o workspace, que o entrega ao
 * `ContextDrawer`. Um unico caminho de contexto para fila, situacao e etapa da cadeia.
 *
 * Consome o MESMO read model `GET /work-inbox` (filtro server-side real, feito pelo cabecalho).
 * Atraso vem do `dueAt` persistido; ausencia de `dueAt` nao e atraso.
 *
 * COLUNAS DA LINHA — a ordem em que o operador decide, igual em todas as filas do produto:
 *   PRIORIDADE (aging real) -> DOCUMENTO (referencia + titulo) -> CONTEXTO -> ESTADO -> PRAZO -> ACAO
 * O cabecalho de colunas e texto real (nao `aria-hidden`): leitor de tela precisa poder navegar por
 * ele, e o operador precisa saber o que cada coluna significa sem adivinhar.
 */
export function WorkInboxSection({
  page,
  phase,
  domainLabel,
  selectedId,
  onSelect,
  onOpenRoute,
  onClearRecorte,
}: {
  page: WorkInboxPage | null;
  phase: 'loading' | 'ready' | 'denied' | 'error';
  /** Nome do recorte ativo — declarado na descricao da fila, para o vazio nao parecer geral. */
  domainLabel: string;
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onOpenRoute: (route: string) => void;
  /** Limpa o recorte de dominio do workspace — a acao REAL do estado vazio por filtro. */
  onClearRecorte: () => void;
}) {
  if (phase === 'denied') {
    return (
      <WorkbenchQueue
        title="Minha fila"
        count={null}
        emptyTitle="Fila de trabalho indisponível"
        emptyDescription="Você não tem permissão para ler a fila de trabalho."
      />
    );
  }

  if (phase === 'error') {
    return (
      <WorkbenchQueue
        title="Minha fila"
        count={null}
        emptyTitle="Não foi possível ler a fila de trabalho"
        emptyDescription="A falha está declarada acima. Abra a Central de trabalho para tentar novamente."
        emptyAction={
          <button
            type="button"
            className={workbenchSecondaryActionClass}
            onClick={() => onOpenRoute('/app/work-inbox')}
          >
            Abrir fila completa
          </button>
        }
      />
    );
  }

  const items = page?.items ?? [];
  const overdueCount = items.filter((item) => daysOverdue(item.dueAt) !== null).length;

  return (
    <WorkbenchQueue
      title="Minha fila"
      count={page?.total ?? null}
      description={
        phase === 'loading'
          ? 'Carregando o trabalho do recorte…'
          : `Recorte: ${domainLabel}${overdueCount > 0 ? ` · ${overdueCount} em atraso nesta página` : ''}`
      }
      action={
        <button
          type="button"
          className={workbenchSecondaryActionClass}
          onClick={() => onOpenRoute('/app/work-inbox')}
        >
          Abrir fila completa
        </button>
      }
      emptyTitle="Nenhum trabalho pendente neste recorte."
      emptyDescription="A fila não inventa pendência para parecer cheia. Ajuste o recorte ou abra a fila completa."
      emptyAction={
        <>
          <button type="button" className={workbenchSecondaryActionClass} onClick={onClearRecorte}>
            Alterar filtros
          </button>
          <button
            type="button"
            className={workbenchPrimaryActionClass}
            onClick={() => onOpenRoute('/app/work-inbox')}
          >
            Abrir fila
          </button>
        </>
      }
    >
      {items.length > 0 ? (
        <div className="dashboard-queue-head">
          <span>Prioridade</span>
          <span>Documento</span>
          <span>Contexto</span>
          <span>Estado</span>
          <span>Prazo</span>
          <span>Próxima ação</span>
        </div>
      ) : null}

      {items.map((item) => {
        const late = daysOverdue(item.dueAt);
        const isSelected = selectedId === item.id;
        return (
          /*
            LINHA UNICA DE TRABALHO: aging real -> objeto -> contexto -> estado -> prazo -> acao.
            UMA acao primaria visivel por linha; o resto do contexto abre no drawer ao clicar no
            documento. Nao existe fileira de oito botoes por registro.
          */
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

            <span className="dashboard-queue-item__context">{item.contextLabel || '—'}</span>

            <span className="dashboard-queue-item__status">{item.status}</span>

            <span className="dashboard-queue-item__due tabular-nums">
              {item.dueAt ? new Date(item.dueAt).toLocaleDateString('pt-BR') : 'Sem prazo'}
            </span>

            <span className="dashboard-queue-item__action">
              <button
                type="button"
                className={workbenchPrimaryActionClass}
                onClick={() => onOpenRoute(item.targetRoute)}
              >
                {item.actionLabel}
              </button>
            </span>

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
