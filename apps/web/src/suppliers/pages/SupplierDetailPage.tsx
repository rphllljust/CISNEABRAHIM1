import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/context/AuthProvider';
import { CommandActionButton } from '../../service-orders/components/CommandActionButton';
import { fetchSupplierAuditTimeline, SupplierMetaApiError } from '../api/supplier-meta-api';
import {
  activateSupplier,
  archiveSupplier,
  deactivateSupplier,
  getSupplier,
} from '../api/suppliers-api';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { useSupplierAvailableActions } from '../hooks/useSupplierAvailableActions';
import type { SupplierAuditTimelineResponse } from '../types/supplier-meta.types';
import type { SupplierDetail } from '../types/supplier.types';

/**
 * Visão geral do fornecedor: identidade, comandos válidos (do backend) e trilha de auditoria.
 *
 * Espelha `ServiceOrderDetailPage` (B5) — mesma estrutura, mesma semântica de estados, e
 * reusa o `CommandActionButton` daquele domínio em vez de recriar o botão. É aqui que fica
 * visível quanto do padrão é genérico: só o NOME do recurso e as rotas mudam.
 */
export function SupplierDetailPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const { expireSession } = useAuth();

  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>(
    'loading',
  );
  const [timeline, setTimeline] = useState<SupplierAuditTimelineResponse | null>(null);
  const [timelineStatus, setTimelineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);
  const [executing, setExecuting] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const commands = useSupplierAvailableActions(supplierId ?? null, true, status);

  /**
   * Executa um comando declarado válido pelo BACKEND.
   *
   * Espelha o executor de `ServiceOrderDetailPage`: o componente não decide o que é possível,
   * apenas despacha o comando recebido para as mutações que já existem no módulo.
   */
  async function runCommand(command: string): Promise<void> {
    if (!supplierId || !supplier) {
      return;
    }
    setExecuting(true);
    setCommandError(null);
    try {
      if (command === 'activate') {
        await activateSupplier(supplierId, { version: supplier.version });
      } else if (command === 'deactivate') {
        await deactivateSupplier(supplierId, {
          version: supplier.version,
          reason: 'Inativação solicitada na visão geral.',
        });
      } else if (command === 'archive') {
        await archiveSupplier(supplierId, {
          version: supplier.version,
          reason: 'Arquivamento solicitado na visão geral.',
        });
      } else {
        setCommandError(`O comando "${command}" não é executado nesta tela.`);
        return;
      }
      setNonce((value) => value + 1);
      commands.reload();
    } catch (error) {
      setCommandError(
        error instanceof BackofficeApiError
          ? mapSupplierErrorToMessage(error.code, error.status)
          : 'Não foi possível executar o comando.',
      );
    } finally {
      setExecuting(false);
    }
  }

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof BackofficeApiError) {
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
    if (!supplierId) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setStatus('loading');

    void getSupplier(supplierId, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setSupplier(data);
          setStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(handleError(error));
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [supplierId, handleError, nonce]);

  useEffect(() => {
    if (!supplierId) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setTimelineStatus('loading');

    void fetchSupplierAuditTimeline(supplierId, { limit: 100, offset: 0 }, controller.signal)
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
        if (error instanceof SupplierMetaApiError && error.status === 401) {
          expireSession();
        }
        setTimelineStatus('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [supplierId, expireSession, nonce]);

  if (status === 'loading') {
    return (
      <div className="p-6" aria-busy="true" aria-live="polite">
        <p>Carregando fornecedor…</p>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="p-6" role="alert">
        <p>Você não tem acesso a este fornecedor.</p>
        <Link to="/app/suppliers">Voltar para a lista</Link>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="p-6" role="alert">
        <p>Fornecedor não encontrado.</p>
        <Link to="/app/suppliers">Voltar para a lista</Link>
      </div>
    );
  }

  if (status === 'error' || !supplier) {
    return (
      <div className="p-6" role="alert">
        <p>Não foi possível carregar o fornecedor.</p>
        <button type="button" onClick={() => setNonce((value) => value + 1)}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <nav aria-label="Navegação">
        <Link to="/app/suppliers">← Fornecedores</Link>
      </nav>

      <header className="mt-4">
        <h1 className="text-xl font-semibold">{supplier.legalName}</h1>
        <p className="mt-1 text-sm text-gray-600">{supplier.tradeName ?? 'Sem nome fantasia'}</p>
        <p className="mt-1 text-xs text-gray-500" data-testid="supplier-status">
          Situação: {supplier.status}
        </p>
      </header>

      <section className="mt-6" aria-labelledby="supplier-acoes-heading">
        <h2 id="supplier-acoes-heading" className="text-base font-semibold">
          Ações disponíveis
        </h2>
        {commands.status === 'loading' ? <p className="mt-2 text-sm">Carregando ações…</p> : null}
        {commands.status === 'error' ? (
          <p className="mt-2 text-sm" role="alert">
            Não foi possível carregar as ações deste fornecedor.
          </p>
        ) : null}
        {commands.status === 'ready' ? (
          commands.data && commands.data.comandos_validos.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2" data-testid="supplier-available-actions">
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
            <p className="mt-2 text-sm text-gray-600" data-testid="supplier-available-actions-empty">
              Nenhuma ação disponível para o estado atual.
            </p>
          )
        ) : null}
        {commandError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {commandError}
          </p>
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="supplier-historico-heading">
        <h2 id="supplier-historico-heading" className="text-base font-semibold">
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
              <ol className="mt-3 space-y-3" data-testid="supplier-audit-timeline">
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
            <p className="mt-2 text-sm text-gray-600" data-testid="supplier-audit-timeline-empty">
              Nenhum evento de auditoria registrado.
            </p>
          )
        ) : null}
      </section>
    </div>
  );
}

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
