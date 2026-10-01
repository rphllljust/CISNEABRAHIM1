import { useCallback, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DateTime, Field, Input, StatusBadge } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistHeader,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { SUPPLIER_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { BackofficeCapabilityRoute } from '../../financial-ui/BackofficeCapabilityRoute';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import {
  activateSupplier,
  archiveSupplier,
  deactivateSupplier,
  getSupplier,
  getSupplierHistory,
  probeSupplierListAccess,
  updateSupplier,
} from '../api/suppliers-api';
import { fetchSupplierAuditTimeline } from '../api/supplier-meta-api';
import type { SupplierAuditTimelineResponse } from '../types/supplier-meta.types';
import { useSupplierAvailableActions } from '../hooks/useSupplierAvailableActions';
import { CommandActionButton } from '../../service-orders/components/CommandActionButton';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import type { SupplierDetail, SupplierHistoryItem } from '../types/supplier.types';

/**
 * EVENTO DO HISTÓRICO — o vocabulário fechado que o servidor persiste é traduzido para o que o
 * operador lê. Valor sem rótulo conhecido aparece CRU, nunca adivinhado.
 */
const SUPPLIER_EVENT_LABELS: Record<string, string> = {
  CREATED: 'Fornecedor cadastrado',
  UPDATED: 'Cadastro atualizado',
  ACTIVATED: 'Fornecedor ativado',
  DEACTIVATED: 'Fornecedor inativado',
  CONTACT_UPDATED: 'Contato atualizado',
};

/**
 * TOM DO EVENTO — derivado do próprio `eventKind` persistido. Não há score nem heurística: o
 * evento de inativação é o único que pede atenção na leitura do histórico.
 */
function supplierEventTone(eventKind: string): 'neutral' | 'warning' {
  return eventKind === 'DEACTIVATED' ? 'warning' : 'neutral';
}

/**
 * O gate do módulo é a concessão de LISTA: sem ela o ator não entra em nenhuma rota de
 * fornecedor, e a navegação por lista continua sendo o caminho de entrada — não um
 * identificador digitado.
 */
export function SuppliersRoute({ children }: { children: ReactNode }) {
  return (
    <BackofficeCapabilityRoute probe={probeSupplierListAccess} capabilityId="suppliers:supplier:list">
      {children}
    </BackofficeCapabilityRoute>
  );
}

export function SuppliersPage() {
  const { supplierId } = useParams();
  const [legalName, setLegalName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const loader = useCallback((signal?: AbortSignal) => getSupplier(supplierId ?? '', signal), [supplierId]);
  const { state, reload, setReady } = useBackofficeQuery<SupplierDetail>({
    loader,
    mapError: mapSupplierErrorToMessage,
    enabled: Boolean(supplierId),
    autoLoad: Boolean(supplierId),
  });
  const historyLoader = useCallback(
    (signal?: AbortSignal) => getSupplierHistory(supplierId ?? '', signal),
    [supplierId],
  );
  const history = useBackofficeQuery<SupplierHistoryItem[]>({
    loader: historyLoader,
    mapError: mapSupplierErrorToMessage,
    enabled: Boolean(supplierId),
    autoLoad: Boolean(supplierId),
  });
  const gate = supplierId
    ? renderQueryGate(
        'Fornecedores',
        'Carregando fornecedor…',
        'Você não tem permissão para ver fornecedores.',
        state,
        () => void reload(),
      )
    : null;

  const historyItems = history.state.phase === 'ready' ? history.state.data : [];
  const contactCount = state.phase === 'ready' ? state.data.contacts.length : 0;

  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  /**
   * Comandos válidos AGORA, decididos pelo backend.
   *
   * Substitui os `disabled={state.data.status === 'ACTIVE'}` que existiam nos formulários
   * abaixo: aquela era uma cópia da regra de transição mantida no front. `status` entra como
   * gatilho de recarga — depois de ativar/inativar/arquivar os comandos válidos mudam.
   */
  const commands = useSupplierAvailableActions(
    supplierId ?? null,
    Boolean(supplierId),
    state.phase === 'ready' ? state.data.status : undefined,
  );

  const auditLoader = useCallback(
    (signal?: AbortSignal) =>
      fetchSupplierAuditTimeline(supplierId ?? '', { limit: 100, offset: 0 }, signal),
    [supplierId],
  );
  const audit = useBackofficeQuery<SupplierAuditTimelineResponse>({
    loader: auditLoader,
    mapError: () => 'Não foi possível carregar o histórico de auditoria.',
    enabled: Boolean(supplierId),
    autoLoad: Boolean(supplierId),
  });

  async function runCommand(command: string): Promise<void> {
    if (state.phase !== 'ready') {
      return;
    }
    setCommandBusy(true);
    setCommandError(null);
    try {
      if (command === 'activate') {
        setReady(await activateSupplier(state.data.id, { version: state.data.version }));
      } else if (command === 'deactivate') {
        setReady(
          await deactivateSupplier(state.data.id, {
            version: state.data.version,
            reason: 'Inativação solicitada na visão geral.',
          }),
        );
      } else if (command === 'archive') {
        setReady(
          await archiveSupplier(state.data.id, {
            version: state.data.version,
            reason: 'Arquivamento solicitado na visão geral.',
          }),
        );
      } else {
        setCommandError(`O comando "${command}" não é executado nesta tela.`);
        return;
      }
      commands.reload();
      void audit.reload();
    } catch (error) {
      setCommandError(
        error instanceof BackofficeApiError
          ? mapSupplierErrorToMessage(error.code, error.status)
          : 'Não foi possível executar o comando.',
      );
    } finally {
      setCommandBusy(false);
    }
  }

  return (
    <ModulePage>
      <WorklistHeader
        title={state.phase === 'ready' ? state.data.legalName : 'Fornecedor'}
        context="Ativação segue segregação de funções no backend."
        action={
          <Link
            to="/app/suppliers"
            className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
          >
            ← Voltar para fornecedores
          </Link>
        }
        metrics={
          state.phase === 'ready' ? (
            <>
              <EnterpriseMetric
                label="Situação"
                value={SUPPLIER_STATUS_LABELS[state.data.status] ?? state.data.status}
                tone={state.data.status === 'ACTIVE' ? 'neutral' : 'warning'}
              />
              <EnterpriseMetric label="CNPJ" value={state.data.taxId} />
              <EnterpriseMetric label="Contatos" value={contactCount} />
              <EnterpriseMetric label="Versão" value={state.data.version} />
            </>
          ) : null
        }
      />
      {gate}
      {state.phase === 'ready' ? (
        <>
          {/*
            IDENTIDADE DO FORNECEDOR — faixa densa acima do registro. Era um cartão
            `rounded-xl p-6 shadow-sm` com `DefinitionList`; os valores continuam sendo exatamente
            os do servidor, e os contatos passam a viver na própria faixa (linha de contexto), não
            como lista solta dentro do cartão.
          */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Identificação do fornecedor"
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-gray-200 px-3 py-2">
              <span className="text-[13px] font-semibold text-gray-900">
                {state.data.legalName}
              </span>
              <FinanceStatusBadge status={state.data.status} labels={SUPPLIER_STATUS_LABELS} />
              {state.data.tradeName ? (
                <span className="text-xs text-gray-500">{state.data.tradeName}</span>
              ) : null}
              <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
                <span>
                  CNPJ <span className="font-mono">{state.data.taxId}</span>
                </span>
                <span>
                  Condição <strong>{state.data.paymentTerms ?? '—'}</strong>
                </span>
                <span>
                  Moeda <strong>{state.data.currencyCode}</strong>
                </span>
                <span>
                  Versão <strong>{state.data.version}</strong>
                </span>
              </span>
            </div>
            <div className="px-3 py-2">
              <h2 className="mb-1 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                Contatos
              </h2>
              {state.data.contacts.length === 0 ? (
                <p className="m-0 text-xs text-gray-500">
                  Nenhum contato cadastrado para este fornecedor.
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
                  {state.data.contacts.map((contact) => (
                    <li key={contact.id} className="text-xs text-gray-600">
                      <span className="font-medium text-gray-900">{contact.name}</span>
                      {contact.email ? ` · ${contact.email}` : ''}
                      {contact.phone ? ` · ${contact.phone}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/*
            AÇÕES DO CADASTRO — ativar/inativar/atualizar eram formulários empilhados que faziam
            a tela parecer backoffice antigo. Continuam sendo exatamente as mesmas chamadas (mesma
            versão, mesmo motivo, mesma decisão de SOD no backend), agora declaradas como AÇÕES.
          */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Ações do fornecedor"
          >
            <div className="border-b border-gray-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-gray-900">Ações disponíveis</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Quais comandos valem AGORA é decidido pelo servidor
                (<code>/suppliers/:id/available-actions</code>). O front apenas renderiza o que
                recebeu — inclusive o rótulo e o veredito de permissão.
              </p>
            </div>
            <div className="px-3 py-2">
              {commands.status === 'loading' ? (
                <p className="text-xs text-gray-500">Carregando ações…</p>
              ) : null}
              {commands.status === 'error' ? (
                <p className="text-xs text-red-700" role="alert">
                  Não foi possível carregar as ações deste fornecedor.
                </p>
              ) : null}
              {commands.status === 'ready' ? (
                commands.data && commands.data.comandos_validos.length > 0 ? (
                  <ul className="flex flex-wrap gap-2" data-testid="supplier-available-actions">
                    {commands.data.comandos_validos.map((action) => (
                      <li key={action.comando}>
                        <CommandActionButton
                          action={action}
                          disabled={commandBusy}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void runCommand(action.comando)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-500" data-testid="supplier-available-actions-empty">
                    Nenhuma ação disponível para o estado atual.
                  </p>
                )
              ) : null}
              {commandError ? (
                <p className="mt-2 text-xs text-red-700" role="alert">
                  {commandError}
                </p>
              ) : null}
            </div>
          </section>

          <section
            className="rounded-lg border border-gray-200 bg-white"
            aria-labelledby="supplier-auditoria-heading"
          >
            <div className="border-b border-gray-200 px-3 py-2">
              <h2
                id="supplier-auditoria-heading"
                className="text-[13px] font-semibold text-gray-900"
              >
                Histórico de auditoria
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Trilha transacional do canal AUDIT_TRAIL (<code>audit.audit_logs</code>), gravada na
                MESMA transação da mutação.
              </p>
            </div>
            <div className="px-3 py-2">
              {audit.state.phase === 'loading' ? (
                <p className="text-xs text-gray-500">Carregando histórico…</p>
              ) : null}
              {audit.state.phase === 'error' ? (
                <p className="text-xs text-red-700" role="alert">
                  Não foi possível carregar o histórico de auditoria.
                </p>
              ) : null}
              {audit.state.phase === 'ready' ? (
                audit.state.data.eventos.length > 0 ? (
                  <>
                    <p className="mb-2 text-[11px] text-gray-500">
                      {audit.state.data.total} evento{audit.state.data.total === 1 ? '' : 's'}
                    </p>
                    <ol className="space-y-3" data-testid="supplier-audit-timeline">
                      {audit.state.data.eventos.map((event) => (
                        <li key={event.id} className="border-l-2 border-gray-200 pl-3">
                          <p className="text-sm">
                            <span className="font-medium">{event.acao}</span>
                            {event.comando ? (
                              <span className="text-gray-600"> · {event.comando}</span>
                            ) : null}
                          </p>
                          <p className="text-xs text-gray-600">
                            {formatAuditInstant(event.data)}
                            {event.status_anterior || event.status_novo
                              ? ` · ${event.status_anterior ?? '—'} → ${event.status_novo ?? '—'}`
                              : ''}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="text-xs text-gray-500" data-testid="supplier-audit-timeline-empty">
                    Nenhum evento de auditoria registrado.
                  </p>
                )
              ) : null}
            </div>
          </section>

          <section
            className="rounded-lg border border-gray-200 bg-white"
            aria-labelledby="supplier-acoes-cadastro-heading"
          >
            <div className="grid grid-cols-1 gap-3 px-3 py-2 lg:grid-cols-2">
              <VersionedActionForm
                title="Ativar"
                description="Ativação exige checker distinto no backend."
                confirmTitle="Ativar fornecedor"
                confirmDescription="A autoativação é recusada pela segregação de funções."
                confirmLabel="Ativar"
                disabled={state.data.status === 'ACTIVE'}
                mapError={mapSupplierErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async () => setReady(await activateSupplier(state.data.id, { version: state.data.version }))}
              />
              <VersionedActionForm
                title="Inativar"
                description="Inativação exige versão atual e motivo."
                confirmTitle="Inativar fornecedor"
                confirmDescription="O servidor recusa conflito de versão."
                confirmLabel="Inativar"
                variant="danger"
                reasonLabel="Motivo"
                disabled={state.data.status !== 'ACTIVE'}
                mapError={mapSupplierErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async ({ reason }) =>
                  setReady(await deactivateSupplier(state.data.id, { version: state.data.version, reason }))
                }
              />
              <CreateRecordForm
                title="Atualizar cadastro"
                description="A alteração exige a versão atual. CNPJ não é alterado nesta tela."
                submitLabel="Salvar"
                mapError={mapSupplierErrorToMessage}
                onSubmit={async () => {
                  setReady(
                    await updateSupplier(state.data.id, {
                      version: state.data.version,
                      legalName: legalName.trim() || undefined,
                      contacts: contactName.trim()
                        ? [
                            {
                              name: contactName.trim(),
                              purpose: 'operational',
                              email: contactEmail.trim() || state.data.contacts[0]?.email || undefined,
                              phone: state.data.contacts[0]?.phone || undefined,
                            },
                          ]
                        : undefined,
                    }),
                  );
                }}
              >
                <Field label="Razão social" htmlFor="supplier-update-legal" className="md:col-span-2">
                  <Input
                    id="supplier-update-legal"
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                    placeholder={state.data.legalName}
                  />
                </Field>
                <Field label="Contato operacional" htmlFor="supplier-update-contact">
                  <Input
                    id="supplier-update-contact"
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    placeholder={state.data.contacts[0]?.name}
                  />
                </Field>
                <Field label="E-mail do contato" htmlFor="supplier-update-email">
                  <Input
                    id="supplier-update-email"
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder={state.data.contacts[0]?.email ?? ''}
                  />
                </Field>
                <p className="text-sm text-gray-500 md:col-span-2">
                  Deixe os campos de contato vazios para preservar o contato atual.
                </p>
              </CreateRecordForm>
            </div>
          </section>

          {/*
            HISTÓRICO EMPRESARIAL — cada linha diz o QUE aconteceu (rótulo humano do
            `eventKind` persistido) e QUANDO, com a hora completa. Antes era uma grade genérica de
            duas colunas exibindo o código cru do evento.
          */}
          <section className="mb-3" aria-label="Histórico do fornecedor">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Histórico do cadastro</h2>
              {history.state.phase === 'ready' ? (
                <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 tabular-nums">
                  {historyItems.length}
                </span>
              ) : null}
            </div>
            {history.state.phase === 'ready' && historyItems.length === 0 ? (
              <WorklistStatePanel
                title="Nenhum evento registrado"
                description="O servidor não publicou eventos para este fornecedor. Cadastro, ativação, inativação e atualização aparecem aqui quando ocorrerem."
              />
            ) : null}
            {historyItems.length > 0 ? (
              <div className={worklistTableCardClass}>
                <table className={worklistTableClass} aria-label="Histórico do fornecedor">
                  <thead>
                    <tr>
                      <th scope="col" className={worklistHeadCellClass}>
                        Evento
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Quando
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyItems.map((item) => (
                      <tr key={item.id} className={worklistRowClass}>
                        <td className={worklistCellRaisedClass}>
                          <StatusBadge
                            tone={supplierEventTone(item.eventKind) === 'warning' ? 'warning' : 'neutral'}
                            label={SUPPLIER_EVENT_LABELS[item.eventKind] ?? item.eventKind}
                          />
                        </td>
                        <td className={worklistCellClass}>
                          <DateTime value={item.occurredAt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
      {!supplierId ? (
        <WorklistStatePanel
          title="Fornecedor não informado"
          description="Volte para a lista e selecione um fornecedor."
          action={
            <Link
              to="/app/suppliers"
              className="text-xs font-semibold text-brand-700 no-underline hover:text-brand-800"
            >
              Ver fornecedores
            </Link>
          }
        />
      ) : null}
    </ModulePage>
  );
}

/** Única transformação local na trilha: formatação do instante ISO para pt-BR. */
function formatAuditInstant(iso: string): string {
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