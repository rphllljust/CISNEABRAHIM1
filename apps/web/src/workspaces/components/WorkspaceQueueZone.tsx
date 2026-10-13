import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOptionalIdentityId } from '../../auth/context/AuthProvider';
import { DynamicSavedViewsBar, useSavedViews } from '../../engine';
import {
  WorkInboxApiError,
  getWorkInbox,
  WORK_DOMAIN_LABELS,
  type WorkDomain,
  type WorkInboxPage,
  type WorkItem,
  type WorkKind,
} from '../../work-inbox/api/work-inbox-api';
import {
  WorkbenchQueue,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { ContextDrawer, type ContextField } from '../../operator';
import { WorkspaceZone } from './WorkspaceZone';
/*
 * A LINHA DE FILA NAO E IMPORTADA AQUI.
 *
 * `.dashboard-queue-item` / `.dashboard-queue-head` sao a linha de trabalho do PRODUTO, e agora
 * moram em `ui/workbench.css` — importado pelo proprio `ui/workbench.tsx`. Como este componente ja
 * consome `WorkbenchQueue`, ele recebe a gramatica junto do componente, sem depender do CSS do
 * dashboard (que e composicao de uma tela especifica e nao deve ser arrastado para um workspace).
 */

/**
 * FILA DE TRABALHO DO WORKSPACE — a zona que faltava.
 *
 * O workspace de dominio tinha AGORA (contagem), ATENCAO (bloqueios) e CONTINUAR (atalhos). Nenhuma
 * das tres e TRABALHO: o operador via o numero, via o problema e ia para outra tela executar. Em
 * ERP Tier-1 o workspace E o lugar onde o trabalho acontece — a fila precisa estar aqui, com o
 * mesmo read model e o mesmo recorte de servidor que a Central de trabalho usa.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE UMA CONSULTA PROPRIA E NAO A REUTILIZACAO DIRETA DA CENTRAL
 *
 * A fila da Central de trabalho e paginada a 25 e vive sob o recorte que o operador escolheu la.
 * O workspace precisa de outra coisa: os PRIMEIROS itens do SEU dominio, com as visoes salvas do
 * SEU dominio — e as duas telas nao devem compartilhar o mesmo estado de visao, senao alternar
 * entre elas mudaria o recorte da outra em silencio.
 *
 * O que NAO se duplica: o endpoint (`GET /work-inbox`), o recorte (server-side, pelo parametro
 * `domain`), o modelo de leitura (`WorkItem`) e os primitivos de apresentacao. Nada e filtrado,
 * contado ou derivado no navegador.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * HONESTIDADE
 *
 * `total` vem do servidor sob o MESMO filtro da pagina — nao e o tamanho do array. Ausencia de
 * leitura nao vira zero: a zona declara a falha. Nenhum item e inventado para preencher a fila.
 */

/** Teto de linhas na zona. A fila completa continua a um clique, com o MESMO recorte. */
const QUEUE_LIMIT = 6;

/**
 * VISOES SALVAS DO DOMINIO — recortes que o SERVIDOR ja sabe aplicar.
 *
 * Só entram as dimensoes que o contrato do read model aceita (`kind`, `overdue`). Inventar uma
 * visao que o servidor nao executa faria o operador salvar um recorte que volta como lista inteira.
 */
const SAVED_VIEW_KINDS: ReadonlyArray<{ kind: WorkKind; label: string }> = [
  { kind: 'BLOCKER', label: 'Bloqueios' },
  { kind: 'OVERDUE', label: 'Vencidos' },
  { kind: 'APPROVAL', label: 'Aguardando aprovação' },
  { kind: 'EXCEPTION', label: 'Exceções' },
];

/** Recorte ATIVO da fila do workspace. `null` = o dominio inteiro. */
type QueueScope = { kind: WorkKind | null; overdue: boolean };

const ALL_SCOPE: QueueScope = { kind: null, overdue: false };

type QueueState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; page: WorkInboxPage; items: WorkItem[] };

function failureMessage(reason: unknown): { phase: 'denied' | 'error'; message: string } {
  if (reason instanceof WorkInboxApiError && reason.kind === 'denied') {
    return {
      phase: 'denied',
      message: 'Você não tem permissão para ler a fila deste domínio.',
    };
  }
  if (reason instanceof WorkInboxApiError && reason.kind === 'network') {
    return {
      phase: 'error',
      message:
        'Não foi possível falar com o servidor. A fila deste domínio é desconhecida — não é vazia.',
    };
  }
  return { phase: 'error', message: 'Não foi possível ler a fila deste domínio.' };
}

function formatMoment(value: string | null): string {
  if (!value) {
    return 'sem prazo';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'sem prazo' : date.toLocaleDateString('pt-BR');
}

/** Dias corridos desde o vencimento. `null` quando nao ha prazo ou ele e futuro. */
function daysOverdue(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const elapsed = Date.now() - due.getTime();
  return elapsed < 0 ? null : Math.floor(elapsed / 86_400_000);
}

function contextFacts(item: WorkItem): ContextField[] {
  return [
    { label: 'Domínio', value: WORK_DOMAIN_LABELS[item.domain] },
    { label: 'Objeto', value: item.businessReference },
    { label: 'Situação', value: item.status },
    { label: 'Motivo', value: item.reason },
    { label: 'Contexto', value: item.contextLabel || '—' },
    { label: 'Prazo', value: formatMoment(item.dueAt) },
  ];
}

export function WorkspaceQueueZone({ domain }: { domain: WorkDomain }) {
  const identityId = useOptionalIdentityId();
  const [scope, setScope] = useState<QueueScope>(ALL_SCOPE);
  const [state, setState] = useState<QueueState>({ phase: 'loading' });
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  /* VISOES SALVAS por dominio: o recorte de Financeiro nao polui o de Operacoes. */
  const savedViews = useSavedViews(identityId ?? null, `workspace.${domain}`);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setState({ phase: 'loading' });
      try {
        const page = await getWorkInbox(
          {
            domain,
            kind: scope.kind ?? undefined,
            overdue: scope.overdue || undefined,
            limit: QUEUE_LIMIT,
            offset: 0,
          },
          controller.signal,
        );
        if (active) {
          setState({ phase: 'ready', page, items: page.items });
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setState(failureMessage(error));
        }
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [domain, scope.kind, scope.overdue, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const scopeLabel =
    scope.kind === null
      ? 'Todo o trabalho do domínio'
      : SAVED_VIEW_KINDS.find((view) => view.kind === scope.kind)?.label ?? 'Recorte';

  const fullQueueHref = `/app/work-inbox?domain=${domain}${
    scope.kind ? `&kind=${scope.kind}` : ''
  }${scope.overdue ? '&overdue=true' : ''}`;

  const items = state.phase === 'ready' ? state.items : [];
  const total = state.phase === 'ready' ? state.page.total : null;

  return (
    <WorkspaceZone
      title="Fila de trabalho"
      note={`${scopeLabel} · recortada no servidor, o mesmo read model da Central de trabalho.`}
      action={
        <button type="button" className={workbenchSecondaryActionClass} onClick={reload}>
          Atualizar
        </button>
      }
    >
      {/*
        VISOES SALVAS — o modo de trabalho do operador, na propria area de trabalho.
        A barra persiste apenas o RECORTE que o servidor executa (`kind`/`overdue`): salvar dado de
        negocio dentro de uma visao seria guardar copia de dado autoritativo do backend.
      */}
      <div className="mb-2">
        <DynamicSavedViewsBar
          views={savedViews.views}
          persistedLocally={savedViews.persistedLocally}
          onSave={(name) =>
            savedViews.save(
              name,
              {
                ...(scope.kind ? { kind: scope.kind } : {}),
                ...(scope.overdue ? { overdue: 'true' } : {}),
              },
              'list',
            )
          }
          onDelete={savedViews.remove}
          onApply={(view) =>
            setScope({
              kind: (view.filters['kind'] as WorkKind | undefined) ?? null,
              overdue: view.filters['overdue'] === 'true',
            })
          }
        />
      </div>

      {/* RECORTES DE SISTEMA — as naturezas que o contrato do read model executa. */}
      <ul className="mb-2 flex list-none flex-wrap items-center gap-1.5 p-0">
        <li>
          <button
            type="button"
            aria-pressed={scope.kind === null && !scope.overdue}
            className={
              scope.kind === null && !scope.overdue
                ? 'rounded border border-brand-600 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800'
                : 'rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50'
            }
            onClick={() => setScope(ALL_SCOPE)}
          >
            Tudo
          </button>
        </li>
        {SAVED_VIEW_KINDS.map((view) => (
          <li key={view.kind}>
            <button
              type="button"
              aria-pressed={scope.kind === view.kind}
              className={
                scope.kind === view.kind
                  ? 'rounded border border-brand-600 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800'
                  : 'rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50'
              }
              onClick={() => setScope({ kind: view.kind, overdue: false })}
            >
              {view.label}
            </button>
          </li>
        ))}
      </ul>

      <WorkbenchQueue
        title="Minha fila do domínio"
        count={total}
        description={
          state.phase === 'loading'
            ? 'Carregando o trabalho do recorte…'
            : state.phase === 'ready'
              ? `Exibindo até ${QUEUE_LIMIT} de ${total ?? 0} ${(total ?? 0) === 1 ? 'item' : 'itens'}`
              : null
        }
        /*
          A ACAO DO CABECALHO SO EXISTE QUANDO HA LINHA PARA ROLAR.

          Com a fila cheia, "Abrir fila completa" e a saida do cabecalho. Com a fila VAZIA, o mesmo
          link ja aparece dentro do estado vazio — e as duas ocorrencias nao sao redundancia
          inofensiva: sao o MESMO destino oferecido duas vezes na mesma dobra, com dois alvos
          identicos para o mesmo clique. O operador escolhe entre duas coisas que sao uma.

          Por isso a acao de cabecalho e OMITIDA no vazio: quem governa a saida ali e o estado
          vazio, que e o lugar onde o operador esta olhando quando nao encontra trabalho.
        */
        action={
          items.length > 0 ? (
            <Link className={workbenchSecondaryActionClass} to={fullQueueHref}>
              Abrir fila completa
            </Link>
          ) : null
        }
        emptyTitle={
          state.phase === 'denied'
            ? 'Fila indisponível'
            : state.phase === 'error'
              ? 'Não foi possível ler a fila'
              : 'Nenhum trabalho pendente neste recorte.'
        }
        emptyDescription={
          state.phase === 'denied' || state.phase === 'error'
            ? state.phase === 'denied'
              ? 'Você não tem permissão para ler a fila deste domínio.'
              : (state as { message: string }).message
            : 'A fila não inventa pendência para parecer cheia. Abra a fila completa ou troque o recorte.'
        }
        emptyAction={
          state.phase === 'ready' ? (
            <>
              {scope.kind !== null || scope.overdue ? (
                <button
                  type="button"
                  className={workbenchSecondaryActionClass}
                  onClick={() => setScope(ALL_SCOPE)}
                >
                  Ver todo o domínio
                </button>
              ) : null}
              <Link className={workbenchPrimaryActionClass} to={fullQueueHref}>
                Abrir fila completa
              </Link>
            </>
          ) : null
        }
      >
        {items.map((item) => {
          const late = daysOverdue(item.dueAt);
          const isSelected = selected?.id === item.id;
          return (
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
                onClick={() => setSelected(item)}
                title="Ver o contexto deste trabalho"
              >
                <span className="dashboard-queue-item__ref">{item.businessReference}</span>
                <span className="dashboard-queue-item__title">{item.title}</span>
              </button>

              <span className="dashboard-queue-item__context">{item.contextLabel || '—'}</span>
              <span className="dashboard-queue-item__status">{item.status}</span>
              <span className="dashboard-queue-item__due tabular-nums">
                {formatMoment(item.dueAt)}
              </span>

              <span className="dashboard-queue-item__action">
                <Link className={workbenchPrimaryActionClass} to={item.targetRoute}>
                  {item.actionLabel}
                </Link>
              </span>

              <p className="dashboard-queue-item__meta">
                <span>{WORK_DOMAIN_LABELS[item.domain]}</span>
                <span aria-hidden>·</span>
                <span>{item.reason}</span>
              </p>
            </article>
          );
        })}
      </WorkbenchQueue>

      {/*
        CONTEXTO DO ITEM — o MESMO primitivo lateral das listas maduras. Nao duplica Object Page:
        entrega o suficiente para decidir e o atalho para o objeto completo.
      */}
      <ContextDrawer
        open={selected !== null}
        title="Contexto do trabalho"
        onClose={() => setSelected(null)}
        preview={
          selected
            ? {
                identifier: selected.businessReference,
                subtitle: selected.title,
                facts: contextFacts(selected),
                nextAction: {
                  label: selected.actionLabel,
                  href: selected.targetRoute,
                  kind: 'primary',
                },
                detailHref: selected.targetRoute,
                detailLabel: 'Abrir objeto completo',
              }
            : null
        }
      />
    </WorkspaceZone>
  );
}
