import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/context/AuthProvider';
import { CommandActionButton } from '../components/CommandActionButton';
import { ServiceOrderStatusBadge } from '../components/ServiceOrderStatusBadge';
import {
  fetchAuditTimeline,
  ServiceOrderMetaApiError,
} from '../api/service-order-meta-api';
import {
  cancelServiceOrder,
  getServiceOrder,
  prepareServiceOrder,
  releaseServiceOrder,
  reopenServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { useAvailableActions } from '../hooks/useAvailableActions';
import type { AuditTimelineResponse } from '../types/service-order-meta.types';
import type { ServiceOrderDetail } from '../types/service-order.types';

/**
 * Visão geral da OS: identidade, comandos válidos (do backend) e trilha de auditoria.
 *
 * Esta tela existe porque os endpoints meta de B4 não tinham onde ser consumidos: havia
 * lista, planejamento, execução, medição e faturamento, mas nenhuma visão geral da OS.
 *
 * Todo o conteúdo abaixo é DADO DO BACKEND. A única transformação local é formatação de
 * data e a escolha de qual superfície abrir ao clicar num comando de etapa.
 */
export function ServiceOrderDetailPage() {
  const { serviceOrderId } = useParams<{ serviceOrderId: string }>();
  const { expireSession } = useAuth();

  const [order, setOrder] = useState<ServiceOrderDetail | null>(null);
  const [orderStatus, setOrderStatus] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>(
    'loading',
  );
  const [timeline, setTimeline] = useState<AuditTimelineResponse | null>(null);
  const [timelineStatus, setTimelineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);
  const [executing, setExecuting] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [pendingJustification, setPendingJustification] = useState<string | null>(null);
  const [justification, setJustification] = useState('');

  const commands = useAvailableActions(serviceOrderId ?? null, true);

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ServiceOrdersApiError) {
        if (error.status === 401) {
          expireSession();
          return 'error' as const;
        }
        if (error.kind === 'denied') {
          return 'denied' as const;
        }
        if (error.kind === 'not_found') {
          return 'missing' as const;
        }
      }
      return 'error' as const;
    },
    [expireSession],
  );

  useEffect(() => {
    if (!serviceOrderId) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setOrderStatus('loading');

    void getServiceOrder(serviceOrderId, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setOrder(data);
          setOrderStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOrderStatus(handleError(error));
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [serviceOrderId, handleError, nonce]);

  useEffect(() => {
    if (!serviceOrderId) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setTimelineStatus('loading');

    void fetchAuditTimeline(serviceOrderId, { limit: 100, offset: 0 }, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setTimeline(data);
          setTimelineStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ServiceOrderMetaApiError && error.status === 401) {
          expireSession();
        }
        setTimelineStatus('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [serviceOrderId, expireSession, nonce]);

  /**
   * Executa um comando que o BACKEND declarou válido em `available-actions`.
   *
   * O executor não decide nada: ele despacha o comando recebido para as mutações que já
   * existem no módulo (`prepare`/`release`/`cancel`/`reopen`). Comandos de etapa
   * (start/pause/resume/complete) pertencem às superfícies de execução/medição, que têm
   * fluxo próprio — levá-los para lá seria reimplementar o executor.
   *
   * `cancel` e `reopen` exigem justificativa: nesse caso o comando fica pendente até o
   * operador informar o motivo.
   */
  async function runCommand(command: string): Promise<void> {
    if (!order) {
      return;
    }
    if (command === 'cancel' || command === 'reopen') {
      setPendingJustification(command);
      return;
    }

    setExecuting(true);
    setCommandError(null);
    try {
      if (command === 'prepare') {
        await prepareServiceOrder(order.id, order.rowVersion);
      } else if (command === 'release') {
        await releaseServiceOrder(order.id, order.rowVersion);
      } else {
        setCommandError(`O comando "${command}" é executado na tela de execução da OS.`);
        return;
      }
      setNonce((value) => value + 1);
      commands.reload();
    } catch (error) {
      setCommandError(
        error instanceof ServiceOrdersApiError
          ? mapServiceOrdersErrorToMessage(error.code, error.status)
          : 'Não foi possível executar o comando.',
      );
    } finally {
      setExecuting(false);
    }
  }

  async function confirmJustification(): Promise<void> {
    if (!order || !pendingJustification) {
      return;
    }
    const reason = (justification ?? '').trim();
    if (reason.length === 0) {
      return;
    }
    setExecuting(true);
    setCommandError(null);
    try {
      if (pendingJustification === 'cancel') {
        await cancelServiceOrder(order.id, {
          rowVersion: order.rowVersion,
          cancellationReason: reason,
        });
      } else {
        await reopenServiceOrder(order.id, {
          rowVersion: order.rowVersion,
          reopenReason: reason,
        });
      }
      setPendingJustification(null);
      setJustification('');
      setNonce((value) => value + 1);
      commands.reload();
    } catch (error) {
      setCommandError(
        error instanceof ServiceOrdersApiError
          ? mapServiceOrdersErrorToMessage(error.code, error.status)
          : 'Não foi possível executar o comando.',
      );
    } finally {
      setExecuting(false);
    }
  }

  if (orderStatus === 'loading') {
    return (
      <div className="p-6" aria-busy="true" aria-live="polite">
        <p>Carregando ordem de serviço…</p>
      </div>
    );
  }

  if (orderStatus === 'denied') {
    return (
      <div className="p-6" role="alert">
        <p>Você não tem acesso a esta ordem de serviço.</p>
        <Link to="/app/service-orders">Voltar para a lista</Link>
      </div>
    );
  }

  if (orderStatus === 'missing') {
    return (
      <div className="p-6" role="alert">
        <p>Ordem de serviço não encontrada.</p>
        <Link to="/app/service-orders">Voltar para a lista</Link>
      </div>
    );
  }

  if (orderStatus === 'error' || !order) {
    return (
      <div className="p-6" role="alert">
        <p>Não foi possível carregar a ordem de serviço.</p>
        <button type="button" onClick={() => setNonce((value) => value + 1)}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <nav aria-label="Navegação">
        <Link to="/app/service-orders">← Ordens de serviço</Link>
      </nav>

      <header className="mt-4">
        <h1 className="text-xl font-semibold">{order.orderNumber}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {order.description ?? 'Sem descrição'}
        </p>
        <div className="mt-2">
          <ServiceOrderStatusBadge status={order.status} />
        </div>
      </header>

      {/* Ações válidas: vêm do backend, incluindo rótulo e veredito de permissão. */}
      <section className="mt-6" aria-labelledby="acoes-heading">
        <h2 id="acoes-heading" className="text-base font-semibold">
          Ações disponíveis
        </h2>
        {commands.status === 'loading' ? <p className="mt-2 text-sm">Carregando ações…</p> : null}
        {commands.status === 'error' ? (
          <p className="mt-2 text-sm" role="alert">
            Não foi possível carregar as ações desta ordem de serviço.
          </p>
        ) : null}
        {commands.status === 'ready' ? (
          commands.data && commands.data.comandos_validos.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2" data-testid="available-actions">
              {commands.data.comandos_validos.map((action) => (
                <li key={action.comando}>
                  <CommandActionButton
                    action={action}
                    disabled={executing}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void runCommand(action.comando)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-600" data-testid="available-actions-empty">
              Nenhuma ação disponível para o estado atual.
            </p>
          )
        ) : null}
        {commandError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {commandError}
          </p>
        ) : null}
        {executing ? (
          <p className="mt-2 text-sm text-gray-500" role="status">
            Executando comando…
          </p>
        ) : null}
      </section>

      {/* Trilha de auditoria: renderizada na ordem entregue pelo backend (created_at ASC). */}
      <section className="mt-8" aria-labelledby="historico-heading">
        <h2 id="historico-heading" className="text-base font-semibold">
          Histórico de auditoria
        </h2>
        {timelineStatus === 'loading' ? <p className="mt-2 text-sm">Carregando histórico…</p> : null}
        {timelineStatus === 'error' ? (
          <p className="mt-2 text-sm" role="alert">
            Não foi possível carregar o histórico.
          </p>
        ) : null}
        {timelineStatus === 'ready' ? (
          timeline && timeline.eventos.length > 0 ? (
            <>
              <p className="mt-1 text-xs text-gray-500">
                {timeline.total} evento{timeline.total === 1 ? '' : 's'}
              </p>
              <ol className="mt-3 space-y-3" data-testid="audit-timeline">
                {timeline.eventos.map((event) => (
                  <li key={event.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm">
                      <span className="font-medium">{event.acao}</span>
                      {event.comando ? <span className="text-gray-600"> · {event.comando}</span> : null}
                    </p>
                    <p className="text-xs text-gray-600">
                      {formatInstant(event.data)}
                      {event.status_anterior || event.status_novo
                        ? ` · ${event.status_anterior ?? '—'} → ${event.status_novo ?? '—'}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-600" data-testid="audit-timeline-empty">
              Nenhum evento de auditoria registrado.
            </p>
          )
        ) : null}
      </section>

      {/*
        CANCELAR e REABRIR exigem justificativa no backend. O comando só é enviado depois
        que o operador informa o motivo — o front não inventa um texto padrão para destravar
        a ação.
      */}
      {pendingJustification ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            pendingJustification === 'cancel' ? 'Cancelar ordem de serviço' : 'Reabrir ordem de serviço'
          }
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <h2 className="text-base font-semibold">
              {pendingJustification === 'cancel' ? 'Cancelar OS' : 'Reabrir OS'}
            </h2>
            <label className="mt-3 block text-sm" htmlFor="command-justification">
              {pendingJustification === 'cancel' ? 'Motivo do cancelamento' : 'Motivo da reabertura'}
            </label>
            <textarea
              id="command-justification"
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
              rows={3}
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-2 text-sm"
                onClick={() => {
                  setPendingJustification(null);
                  setJustification('');
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={executing || justification.trim().length === 0}
                onClick={() => void confirmJustification()}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Única transformação local permitida: formatação do instante ISO para pt-BR. */
function formatInstant(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Porto_Velho',
  }).format(parsed);
}
