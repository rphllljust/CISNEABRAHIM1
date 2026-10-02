import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  cancelServiceOrder,
  getServiceOrder,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { ActionBar, DynamicForm, toDisplayText, useEntitySchema } from '../../engine';
import {
  serviceOrderEngineRow,
  type ServiceOrderEngineRow,
} from './service-order-engine-rows';

/**
 * Detalhe de ordem de serviço RENDERIZADO PELA ENGINE.
 *
 * Não há campo, rótulo, grupo nem ordem escritos aqui: `DynamicForm` lê a view `form` do
 * metadata store e `ActionBar` lê `meta.workflow_transitions`. Os 7 botões de ciclo de vida
 * deixaram de vir de `TRANSITIONS` (constante TypeScript) e passaram a vir do metadado —
 * a transição nova é um INSERT.
 *
 * O que permanece é APENAS o despacho do comando para as mutações que já existem no módulo:
 * a engine decide QUAIS comandos existem e QUAIS o ator pode executar; este despachante
 * decide apenas COMO cada um chega ao backend.
 */
export function ServiceOrderEngineDetailPage() {
  const { serviceOrderId } = useParams<{ serviceOrderId: string }>();
  const { schema, status } = useEntitySchema('service-orders');
  const [row, setRow] = useState<ServiceOrderEngineRow | null>(null);
  const [rowStatus, setRowStatus] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!serviceOrderId) {
        return;
      }
      setRowStatus('loading');
      try {
        const detail = await getServiceOrder(serviceOrderId, signal);
        setRow(serviceOrderEngineRow(detail));
        setRowStatus('ready');
      } catch (error) {
        if (error instanceof ServiceOrdersApiError) {
          if (error.kind === 'denied') {
            setRowStatus('denied');
            return;
          }
          if (error.kind === 'not_found') {
            setRowStatus('missing');
            return;
          }
        }
        setRowStatus('error');
      }
    },
    [serviceOrderId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /**
   * Despacha o comando que a ENGINE ofereceu.
   *
   * `cancel` exige justificativa no backend (`cancellationReason`), por isso a tela informa
   * uma justificativa explícita em vez de inventar uma vazia. `start`, `pause`, `resume` e
   * `complete` pertencem à tela de execução, que tem o contexto operacional (alocações,
   * evidências) — aqui elas aparecem como indisponíveis, não como botões que falhariam.
   */
  async function runCommand(command: string): Promise<void> {
    if (!serviceOrderId || !row) {
      return;
    }
    const rowVersion = Number(row['row_version'] ?? 1);
    setBusy(true);
    setCommandError(null);
    try {
      if (command === 'prepare') {
        await prepareServiceOrder(serviceOrderId, rowVersion);
      } else if (command === 'release') {
        await releaseServiceOrder(serviceOrderId, rowVersion);
      } else if (command === 'cancel') {
        await cancelServiceOrder(serviceOrderId, {
          rowVersion,
          cancellationReason: 'Cancelamento solicitado na visão geral da ordem de serviço.',
        });
      } else {
        setCommandError(`O comando "${command}" não é executado nesta tela.`);
        return;
      }
      await load();
    } catch (error) {
      setCommandError(
        error instanceof ServiceOrdersApiError
          ? mapServiceOrdersErrorToMessage(error.code, error.status)
          : 'Não foi possível executar o comando.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (rowStatus === 'loading' || status === 'loading') {
    return (
      <div className="p-6" aria-busy="true">
        <p className="text-sm text-gray-600">Carregando ordem de serviço…</p>
      </div>
    );
  }

  if (rowStatus === 'denied') {
    return (
      <div className="p-6" role="alert">
        <p className="text-sm">Você não tem acesso a esta ordem de serviço.</p>
        <Link to="/app/service-orders">Voltar para a lista</Link>
      </div>
    );
  }

  if (rowStatus === 'missing') {
    return (
      <div className="p-6" role="alert">
        <p className="text-sm">Ordem de serviço não encontrada.</p>
        <Link to="/app/service-orders">Voltar para a lista</Link>
      </div>
    );
  }

  if (rowStatus === 'error' || !row || !schema) {
    return (
      <div className="p-6" role="alert">
        <p className="text-sm">Não foi possível carregar a ordem de serviço.</p>
      </div>
    );
  }

  const currentState = toDisplayText(row['status']);

  return (
    <div className="p-6">
      <nav aria-label="Navegação" className="mb-3">
        <Link to="/app/service-orders">← Ordens de serviço</Link>
      </nav>

      <header className="mb-4">
        <h1 className="text-xl font-semibold">
          {toDisplayText(row['order_number']) || schema.label}
        </h1>
        <p className="mt-1 text-xs text-gray-500">
          Estado atual: <span data-testid="engine-current-state">{currentState}</span>
        </p>
      </header>

      <section className="mb-6" aria-labelledby="engine-actions-heading">
        <h2 id="engine-actions-heading" className="mb-2 text-sm font-semibold">
          Ações disponíveis
        </h2>
        <ActionBar
          schema={schema}
          currentState={currentState}
          busy={busy}
          onCommand={(command) => void runCommand(command)}
        />
        {commandError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {commandError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="engine-form-heading">
        <h2 id="engine-form-heading" className="mb-2 text-sm font-semibold">
          Dados da ordem
        </h2>
        <DynamicForm schema={schema} values={row} readOnly />
      </section>
    </div>
  );
}
