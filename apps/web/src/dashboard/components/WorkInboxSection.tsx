import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextDrawer, type ContextPreviewBody } from '../../operator';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
} from '../../ui/workbench';
import { WorklistException } from '../../ui/enterprise-list';
import {
  WORK_DOMAIN_LABELS,
  WORK_KIND_LABELS,
  getWorkInbox,
  type WorkInboxPage,
  type WorkItem,
} from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../work-inbox/pages/WorkInboxPage';

/**
 * MINHA FILA — a fila de trabalho real de todo o ERP, composta DENTRO do painel.
 *
 * Nao duplica backend: consome o MESMO read model `GET /work-inbox` da Central de trabalho.
 * A composicao e a mesma fila (severidade -> objeto -> vencimento -> proxima acao) e o MESMO
 * `ContextDrawer` da tela dedicada, para que o operador processe trabalho sem sair do Command
 * Center. Nenhum dado e derivado aqui: atraso vem do `dueAt` persistido; ausencia de `dueAt`
 * nao e atraso.
 */

const DEFAULT_LIMIT = 8;

function formatMoment(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('pt-BR');
}

export function WorkInboxSection() {
  const navigate = useNavigate();
  const [page, setPage] = useState<WorkInboxPage | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [selected, setSelected] = useState<WorkItem | null>(null);

  const filters = useMemo(
    () => ({ limit: DEFAULT_LIMIT, offset: 0 }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void getWorkInbox(filters, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPage(result);
          setPhase('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPhase('error');
        }
      });
    return () => controller.abort();
  }, [filters]);

  const items = page?.items ?? [];

  if (phase === 'denied') {
    return null;
  }

  if (phase === 'error') {
    return null;
  }

  return (
    <>
      <WorkbenchQueue
        title="Minha fila"
        count={page?.total ?? null}
        description="Trabalho real autorizado, de todos os domínios. Selecione um item para ver contexto sem sair do painel."
        emptyTitle="Nenhum trabalho real neste recorte."
        emptyDescription="A fila não inventa pendência para parecer cheia."
        action={
          <Link className="text-xs font-semibold text-brand-700 no-underline hover:text-brand-800" to="/app/work-inbox">
            Ver fila completa
          </Link>
        }
      >
        {items.map((item) => {
          const late = daysOverdue(item.dueAt);
          return (
            <WorkbenchQueueItem
              key={item.id}
              severityTone={late !== null ? 'critical' : 'info'}
              severity={
                late !== null ? (
                  <WorklistException tone="critical">
                    {late} dia{late === 1 ? '' : 's'}
                  </WorklistException>
                ) : (
                  <WorklistException tone="info">{item.status}</WorklistException>
                )
              }
              title={item.title}
              reason={item.reason}
              context={
                <>
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                    onClick={() => setSelected(item)}
                  >
                    {item.businessReference}
                  </button>
                  {/* ABREVIAÇÃO DOS DOMÍNIOS NA FILA EMBEBIDA: mantém densidade sem repetir o rótulo
                      humano inteiro; a natureza fica no drawer. O rótulo completo está na tela
                      dedicada. */}
                  <span className="ml-2 text-xs text-gray-500">
                    {WORK_DOMAIN_LABELS[item.domain]}
                  </span>
                </>
              }
              age={<>Venc. {formatMoment(item.dueAt)}</>}
              action={
                <Link className={workbenchPrimaryActionClass} to={item.targetRoute}>
                  {item.actionLabel}
                </Link>
              }
            />
          );
        })}
      </WorkbenchQueue>

      <ContextDrawer
        open={selected !== null}
        title="Contexto do trabalho"
        onClose={() => setSelected(null)}
        preview={selected ? buildInboxPreview(selected) : null}
        // drawer pode navegar sozinho por nextAction; o painel nao precisa de rota propria aqui
      />
    </>
  );

  function buildInboxPreview(item: WorkItem): ContextPreviewBody {
    return {
      identifier: item.businessReference,
      subtitle: item.title,
      facts: [
        { label: 'Domínio', value: WORK_DOMAIN_LABELS[item.domain] },
        { label: 'Natureza', value: WORK_KIND_LABELS[item.kind] },
        { label: 'Situação', value: item.status },
        { label: 'Motivo', value: item.reason },
        { label: 'Contexto', value: item.contextLabel || '—' },
        { label: 'Vencimento', value: formatMoment(item.dueAt) },
        {
          label: 'Exceção',
          value: daysOverdue(item.dueAt) !== null ? `${daysOverdue(item.dueAt)} dia(s) em atraso` : null,
        },
      ],
      nextAction: {
        label: item.actionLabel,
        onClick: () => {
          setSelected(null);
          void navigate(item.targetRoute);
        },
        kind: 'primary',
      },
    };
  }
}
