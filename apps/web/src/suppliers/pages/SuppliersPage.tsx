import { useCallback, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DateTime, EmptyState, Field, Input } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  WorklistHeader,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { SUPPLIER_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { BackofficeCapabilityRoute } from '../../financial-ui/BackofficeCapabilityRoute';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import {
  activateSupplier,
  deactivateSupplier,
  getSupplier,
  getSupplierHistory,
  probeSupplierListAccess,
  updateSupplier,
} from '../api/suppliers-api';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import type { SupplierDetail, SupplierHistoryItem } from '../types/supplier.types';

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

  return (
    <ModulePage>
      <WorklistHeader
        title={state.phase === 'ready' ? state.data.legalName : 'Fornecedor'}
        context="Ativação segue segregação de funções no backend."
        action={
          <Link className="text-sm font-semibold text-gray-700 hover:text-gray-900" to="/app/suppliers">
            Voltar para a lista
          </Link>
        }
      />
      {gate}
      {state.phase === 'ready' ? (
        <>
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                {
                  label: 'Status',
                  value: <FinanceStatusBadge status={state.data.status} labels={SUPPLIER_STATUS_LABELS} />,
                },
                { label: 'Razão social', value: state.data.legalName },
                { label: 'Nome fantasia', value: state.data.tradeName ?? '—' },
                { label: 'CNPJ', value: state.data.taxId },
                { label: 'Condição de pagamento', value: state.data.paymentTerms ?? '—' },
                { label: 'Moeda', value: state.data.currencyCode },
                { label: 'Versão', value: String(state.data.version) },
              ]}
            />
            {state.data.contacts.length > 0 ? (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Contatos</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  {state.data.contacts.map((contact) => (
                    <li key={contact.id}>
                      {contact.name}
                      {contact.email ? ` — ${contact.email}` : ''}
                      {contact.phone ? ` — ${contact.phone}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
          </div>
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
          {history.state.phase === 'ready' && history.state.data.length > 0 ? (
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
                  {history.state.data.map((item) => (
                    <tr key={item.id} className={worklistRowClass}>
                      <td className={worklistCellRaisedClass}>{item.eventKind}</td>
                      <td className={worklistCellClass}>
                        <DateTime value={item.occurredAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
      {!supplierId ? (
        <EmptyState title="Fornecedor não informado" description="Volte para a lista e selecione um fornecedor." />
      ) : null}
    </ModulePage>
  );
}
