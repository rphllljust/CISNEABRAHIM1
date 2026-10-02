import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  activateSupplier,
  archiveSupplier,
  deactivateSupplier,
  getSupplier,
} from '../api/suppliers-api';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import { ActionBar, DynamicForm, toDisplayText, useEntitySchema } from '../../engine';
import { supplierEngineRow, type SupplierEngineRow } from './supplier-engine-rows';

/**
 * Detalhe de fornecedor RENDERIZADO PELA ENGINE.
 *
 * Não há campo, rótulo, grupo nem ordem escritos aqui: `DynamicForm` lê a view `form` do
 * metadata store, e `ActionBar` lê as transições de `meta.workflow_transitions`. Adicionar
 * um campo é um INSERT; adicionar um estado é um INSERT.
 *
 * O que permanece é APENAS o despacho do comando para as mutações que já existem no módulo —
 * a engine não sabe o que `activate` faz no backend, e não deveria saber.
 */
export function SuppliersEngineDetailPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const { schema, status } = useEntitySchema('suppliers');
  const [row, setRow] = useState<SupplierEngineRow | null>(null);
  const [rowStatus, setRowStatus] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>(
    'loading',
  );
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!supplierId) {
        return;
      }
      setRowStatus('loading');
      try {
        const detail = await getSupplier(supplierId, signal);
        const adapted = supplierEngineRow(detail);
        setRow(adapted);
        setValues(adapted);
        setRowStatus('ready');
      } catch (error) {
        if (error instanceof BackofficeApiError) {
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
    [supplierId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /**
   * Despacha o comando que a ENGINE ofereceu.
   *
   * A engine decide QUAIS comandos existem (via workflow) e QUAIS o ator pode executar (via
   * `allowed`). Este despachante decide apenas COMO cada um chega ao backend — conhecimento
   * que só o módulo tem.
   */
  async function runCommand(command: string): Promise<void> {
    if (!supplierId || !row) {
      return;
    }
    const version = Number(row['version'] ?? 1);
    setBusy(true);
    setCommandError(null);
    try {
      if (command === 'activate') {
        await activateSupplier(supplierId, { version });
      } else if (command === 'deactivate') {
        await deactivateSupplier(supplierId, {
          version,
          reason: 'Inativação solicitada na tela de fornecedor.',
        });
      } else if (command === 'archive') {
        await archiveSupplier(supplierId, {
          version,
          reason: 'Arquivamento solicitado na tela de fornecedor.',
        });
      } else {
        setCommandError(`O comando "${command}" não é executado nesta tela.`);
        return;
      }
      await load();
    } catch (error) {
      setCommandError(
        error instanceof BackofficeApiError
          ? mapSupplierErrorToMessage(error.code, error.status)
          : 'Não foi possível executar o comando.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (rowStatus === 'loading' || status === 'loading') {
    return (
      <div className="p-6" aria-busy="true">
        <p className="text-sm text-gray-600">Carregando fornecedor…</p>
      </div>
    );
  }

  if (rowStatus === 'denied') {
    return (
      <div className="p-6" role="alert">
        <p className="text-sm">Você não tem acesso a este fornecedor.</p>
        <Link to="/app/suppliers">Voltar para a lista</Link>
      </div>
    );
  }

  if (rowStatus === 'missing') {
    return (
      <div className="p-6" role="alert">
        <p className="text-sm">Fornecedor não encontrado.</p>
        <Link to="/app/suppliers">Voltar para a lista</Link>
      </div>
    );
  }

  if (rowStatus === 'error' || !row || !schema) {
    return (
      <div className="p-6" role="alert">
        <p className="text-sm">Não foi possível carregar o fornecedor.</p>
      </div>
    );
  }

  const currentState = toDisplayText(row['status']);

  return (
    <div className="p-6">
      <nav aria-label="Navegação" className="mb-3">
        <Link to="/app/suppliers">← Fornecedores</Link>
      </nav>

      <header className="mb-4">
        <h1 className="text-xl font-semibold">
          {toDisplayText(values['legal_name']) || schema.label}
        </h1>
        <p className="mt-1 text-xs text-gray-500">
          Estado atual: <span data-testid="engine-current-state">{currentState}</span>
        </p>
      </header>

      <section className="mb-6" aria-labelledby="engine-actions-heading">
        <h2 id="engine-actions-heading" className="mb-2 text-sm font-semibold">
          Ações disponíveis
        </h2>
        <ActionBar schema={schema} currentState={currentState} busy={busy} onCommand={(command) => void runCommand(command)} />
        {commandError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {commandError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="engine-form-heading">
        <h2 id="engine-form-heading" className="mb-2 text-sm font-semibold">
          Dados do cadastro
        </h2>
        <DynamicForm schema={schema} values={values} readOnly />
      </section>
    </div>
  );
}
