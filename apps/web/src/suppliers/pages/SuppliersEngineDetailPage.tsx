import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  activateSupplier,
  archiveSupplier,
  deactivateSupplier,
  getSupplier,
  getSupplierHistory,
} from '../api/suppliers-api';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import { ActionBar, DynamicForm, toDisplayText, useEntitySchema } from '../../engine';
import { supplierEngineRow } from './supplier-engine-rows';
import type { SupplierDetail, SupplierHistoryItem } from '../types/supplier.types';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  toHumanText,
  type NextAction,
  type ObjectContextField,
  type ObjectHeaderStatus,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';

/**
 * OBJECT PAGE DE FORNECEDOR.
 *
 * ANTES: um cabecalho com `Estado atual: ACTIVE` (enum cru), um `ActionBar` da engine e um
 * `DynamicForm` somente leitura. O operador via os campos, mas a tela nao respondia o que uma
 * object page precisa responder: qual e a EXCECAO (por que este fornecedor nao pode receber
 * compra), qual e a PROXIMA ACAO, de onde o cadastro veio e com o que se relaciona. Nenhum
 * historico e nenhuma relacao apareciam, e os estados de erro eram `<div className="p-6">`.
 *
 * A moldura agora e o contrato canonico (`EnterpriseObjectPage`), na ordem publicada em
 * `enterprise-object/index.ts`:
 *
 *   breadcrumb -> header -> estado -> proxima acao -> contexto -> corpo | historico
 *
 * HONESTIDADE DOS DADOS:
 *   - o estado vem ROTULADO, nunca como enum cru, e o fluxo do ciclo de vida usa apenas os
 *     estados que o dominio realmente declara (rascunho de cadastro nao existe aqui);
 *   - a proxima acao e derivada do estado REAL e do comando que a engine oferece — sem
 *     `setStatus`, sem transicao inventada;
 *   - o historico usa os eventos PERSISTIDOS de `/suppliers/:id/history`; o identificador do
 *     ator e tecnico e por isso nao entra na tela;
 *   - `SmartRelationBar` NAO e usado: o payload nao publica contagem de relacoes, e um numero
 *     sem contagem autoritativa seria um numero orfao. GAP REGISTRADO, nao preenchido.
 */

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
  ARCHIVED: 'Arquivado',
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  ACTIVE: 'Habilitado a receber pedidos de compra.',
  INACTIVE: 'Fora de operação: não pode receber pedidos de compra.',
  SUSPENDED: 'Bloqueado temporariamente para novas compras.',
  ARCHIVED: 'Cadastro encerrado. Reative para voltar a comprar.',
};

const STATUS_TONES: Record<string, ObjectHeaderStatus['tone']> = {
  ACTIVE: 'operational',
  INACTIVE: 'warning',
  SUSPENDED: 'warning',
  ARCHIVED: 'error',
};

/**
 * Ciclo de vida real do cadastro: ativo -> inativo/suspenso -> arquivado.
 *
 * Sao os estados que o dominio usa e que o backend transita. Nao ha etapa intermediaria
 * inventada para "preencher" o fluxo.
 */
const LIFECYCLE_STEPS: ObjectStateStep[] = [
  { id: 'ACTIVE', label: 'Ativo' },
  { id: 'INACTIVE', label: 'Inativo' },
  { id: 'ARCHIVED', label: 'Arquivado', terminal: true },
];

/** Rotulo humano do evento persistido. */
const HISTORY_EVENT_LABELS: Record<string, string> = {
  CREATED: 'Cadastro criado',
  ACTIVATED: 'Reativado',
  DEACTIVATED: 'Inativado',
  ARCHIVED: 'Arquivado',
  UPDATED: 'Cadastro atualizado',
};

/**
 * Historico a partir dos eventos PERSISTIDOS.
 *
 * O payload guarda `eventKind`, `occurredAt` e `actorIdentityId`. O identificador do ator e
 * tecnico e por isso NAO entra na tela; nenhum ator e inventado para suprir a lacuna.
 */
export function supplierActivityFacts(history: SupplierHistoryItem[]): ActivityFact[] {
  return history.map((event) => ({
    at: event.occurredAt,
    event: HISTORY_EVENT_LABELS[event.eventKind] ?? toHumanText(event.eventKind) ?? 'Evento registrado',
  }));
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'missing' }
  | { phase: 'error' }
  | { phase: 'ready'; detail: SupplierDetail; history: SupplierHistoryItem[] };

export function SuppliersEngineDetailPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const { schema } = useEntitySchema('suppliers');
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!supplierId) {
        return;
      }
      setPageState({ phase: 'loading' });
      try {
        /*
         * O historico e buscado junto: uma object page que abre sem os fatos persistidos
         * obriga o operador a recarregar para saber o que aconteceu com o cadastro. A falha do
         * historico NAO derruba a pagina — o registro e o dado principal, o historico e apoio.
         */
        const [detail, history] = await Promise.all([
          getSupplier(supplierId, signal),
          getSupplierHistory(supplierId, signal).catch(() => [] as SupplierHistoryItem[]),
        ]);
        if (signal?.aborted) {
          return;
        }
        setValues(supplierEngineRow(detail));
        setPageState({ phase: 'ready', detail, history });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (error instanceof BackofficeApiError) {
          if (error.kind === 'denied') {
            setPageState({ phase: 'denied' });
            return;
          }
          if (error.kind === 'not_found') {
            setPageState({ phase: 'missing' });
            return;
          }
        }
        setPageState({ phase: 'error' });
      }
    },
    [supplierId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(() => setReloadNonce((value) => value + 1), []);

  useEffect(() => {
    if (reloadNonce === 0) {
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // `reloadNonce` e o gatilho deliberado; `load` ja depende de `supplierId`.
  }, [reloadNonce, load]);

  const detail = pageState.phase === 'ready' ? pageState.detail : null;

  /**
   * Proxima acao REAL, derivada do estado do cadastro.
   *
   * Para fornecedor fora de operacao, o proximo passo e reativar — e o comando existe no
   * backend. Para fornecedor ativo, o proximo passo e emitir a compra: a acao NAVEGA para a
   * tela que executa o passo, em vez de oferecer um botao que mentiria sobre o que faz.
   */
  const nextAction = useMemo<NextAction | null>(() => {
    if (!detail) {
      return null;
    }
    if (detail.status === 'ACTIVE') {
      return {
        kind: 'act',
        label: 'Emitir pedido de compra',
        description: 'O cadastro está ativo e pode receber compras.',
        to: `/app/purchase-orders/new?supplierId=${detail.id}`,
      };
    }
    return {
      kind: 'act',
      label: 'Reativar cadastro',
      description: 'Enquanto estiver fora de operação, este fornecedor não pode receber compras.',
    };
  }, [detail]);

  /**
   * Despacha o comando que a ENGINE ofereceu.
   *
   * A engine decide QUAIS comandos existem (via workflow) e QUAIS o ator pode executar. Este
   * despachante decide apenas COMO cada um chega ao backend.
   */
  async function runCommand(command: string): Promise<void> {
    if (!supplierId || !detail) {
      return;
    }
    setBusy(true);
    setCommandError(null);
    try {
      if (command === 'activate') {
        await activateSupplier(supplierId, { version: detail.version });
      } else if (command === 'deactivate') {
        await deactivateSupplier(supplierId, {
          version: detail.version,
          reason: 'Inativação solicitada na tela de fornecedor.',
        });
      } else if (command === 'archive') {
        await archiveSupplier(supplierId, {
          version: detail.version,
          reason: 'Arquivamento solicitado na tela de fornecedor.',
        });
      } else {
        setCommandError(`O comando "${command}" não é executado nesta tela.`);
        return;
      }
      reload();
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

  if (pageState.phase !== 'ready' || !detail || !schema) {
    const phase =
      pageState.phase === 'ready' ? 'loading' : pageState.phase;
    return (
      <EnterpriseObjectPage
        header={null}
        phase={phase === 'missing' ? 'empty' : phase}
        phaseTitle="Fornecedor"
        phaseMessage={
          phase === 'denied'
            ? 'Você não tem acesso a este fornecedor.'
            : phase === 'missing'
              ? 'Este fornecedor não está mais disponível.'
              : phase === 'error'
                ? 'Não foi possível carregar o fornecedor.'
                : 'Carregando fornecedor…'
        }
        onRetry={phase === 'error' ? reload : undefined}
      />
    );
  }

  const statusLabel = STATUS_LABELS[detail.status] ?? toHumanText(detail.status) ?? detail.status;
  const currentState = toDisplayText(detail.status);

  const contextFields: ObjectContextField[] = [
    { label: 'Razão social', value: detail.legalName },
    { label: 'Nome fantasia', value: detail.tradeName },
    { label: 'CNPJ', value: detail.taxId },
    { label: 'Condição de pagamento', value: detail.paymentTerms },
    { label: 'Moeda', value: detail.currencyCode },
    ...(detail.deactivationReason
      ? [{ label: 'Motivo da última inativação', value: detail.deactivationReason }]
      : []),
  ];

  const statusSummary: ObjectHeaderStatus = {
    label: statusLabel,
    tone: STATUS_TONES[detail.status] ?? 'neutral',
    description: STATUS_DESCRIPTIONS[detail.status],
  };

  return (
    <EnterpriseObjectPage
      breadcrumb={[{ label: 'Fornecedores', href: '/app/suppliers' }, { label: detail.legalName }]}
      header={
        <EnterpriseObjectHeader
          title={detail.legalName}
          subtitle={detail.tradeName}
          status={statusSummary}
          metadata={[
            { label: 'CNPJ', value: detail.taxId },
            { label: 'Condição de pagamento', value: detail.paymentTerms },
            { label: 'Moeda', value: detail.currencyCode },
            { label: 'Versão do cadastro', value: `v${detail.version}` },
          ]}
        />
      }
      stateFlow={
        <ObjectStateFlow
          steps={LIFECYCLE_STEPS}
          currentId={LIFECYCLE_STEPS.some((step) => step.id === detail.status) ? detail.status : null}
          title="Ciclo de vida"
        />
      }
      nextAction={<NextActionPanel action={nextAction} />}
      context={<ObjectContextBlock fields={contextFields} columns={3} />}
      aside={
        <ObjectPanel>
          <ActivityTimeline
            facts={supplierActivityFacts(pageState.history)}
            title="Histórico"
            emptyMessage="Nenhum evento de histórico registrado para este fornecedor."
          />
        </ObjectPanel>
      }
    >
      <ObjectPanel title="Ações disponíveis">
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
      </ObjectPanel>

      <ObjectPanel title="Dados do cadastro">
        <DynamicForm schema={schema} values={values} readOnly />
      </ObjectPanel>

      {detail.contacts.length > 0 ? (
        <ObjectPanel title="Contatos">
          <ul className="m-0 list-none space-y-1.5 p-0">
            {detail.contacts.map((contact) => (
              <li key={contact.id} className="text-sm text-gray-700">
                <span className="font-medium">{contact.name}</span>
                {contact.purpose ? <span className="text-gray-500"> · {contact.purpose}</span> : null}
                {contact.email ? <span className="text-gray-500"> · {contact.email}</span> : null}
                {contact.phone ? <span className="text-gray-500"> · {contact.phone}</span> : null}
              </li>
            ))}
          </ul>
        </ObjectPanel>
      ) : null}
    </EnterpriseObjectPage>
  );
}
