import { useCallback, useState } from 'react';
import { DateTime, EmptyState, Field, Input, Money, Select } from '../../ui';
import {
  ModuleTableCard,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { COLLECTION_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  getCurrentCollection,
  openCollection,
  recordCollectionAction,
  recordCollectionPromise,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type { CollectionCase } from '../types/finance.types';

export function CollectionPanel({
  receivableId,
  receivable,
  onChanged,
}: {
  receivableId: string;
  /**
   * Contexto do título pai (status/lifecycle devolvidos pelo GET do título).
   * Sem ele, um 404 do GET de cobrança não pode ser distinguido de "sem caso
   * aberto" e não oferecemos "abrir cobrança" às cegas.
   */
  receivable?: { status: string; lifecycle: string } | null;
  /** Chamado após ações do painel que podem alterar o título pai. */
  onChanged?: () => void;
}) {
  const [kind, setKind] = useState('CONTACT');
  const [notes, setNotes] = useState('');
  const [promisedAmount, setPromisedAmount] = useState('');
  const [promisedOn, setPromisedOn] = useState('');
  const loader = useCallback(
    (signal?: AbortSignal) => getCurrentCollection(receivableId, signal),
    [receivableId],
  );
  const { state, reload, setReady } = useBackofficeQuery<CollectionCase>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const gate = renderQueryGate(
    'Cobrança',
    'Carregando cobrança…',
    'Você não tem permissão para ver a cobrança deste título.',
    state,
    () => void reload(),
  );

  if (state.phase === 'denied') {
    return null;
  }

  if (state.phase === 'error' && state.kind === 'not_found') {
    // 404 do GET = não há caso de cobrança aberto PARA ESTE TÍTULO. O backend
    // (domain/collection.ts assertCanOpenCollection) só abre caso em título
    // ativo, com saldo e vencido. Quando o painel não confirma essa condição
    // (ou o título não está vencido), mostrar "abrir cobrança" seria sucesso
    // falso: o servidor recusaria a abertura.
    const canOpen = Boolean(
      receivable && receivable.lifecycle === 'ACTIVE' && receivable.status === 'OVERDUE',
    );
    return (
      <div className="mb-6">
        {canOpen ? (
          <EmptyState
            title="Nenhuma cobrança aberta"
            description="O servidor só abre cobrança quando o título está vencido."
            action={
              <VersionedActionForm
                title="Abrir cobrança"
                description="A abertura é recusada se o título não estiver vencido."
                confirmTitle="Abrir cobrança"
                confirmDescription="O backend decide se o caso pode ser aberto."
                confirmLabel="Abrir cobrança"
                mapError={mapFinanceErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async () => {
                  setReady(await openCollection(receivableId));
                  onChanged?.();
                }}
              />
            }
          />
        ) : (
          <EmptyState
            title="Nenhuma cobrança aberta"
            description={
              receivable
                ? 'O servidor abre cobrança apenas para títulos ativos, com saldo e vencidos. Este título não está nessa condição.'
                : 'Não foi possível confirmar a condição do título para abrir cobrança.'
            }
          />
        )}
      </div>
    );
  }

  if (gate) {
    return <div className="mb-6">{gate}</div>;
  }
  if (state.phase !== 'ready') {
    return null;
  }

  const collection = state.data;
  const closed = collection.status === 'CLOSED';

  function afterChildChange(next: CollectionCase) {
    setReady(next);
    onChanged?.();
  }

  return (
    <section className="mb-6" aria-labelledby="collection-heading">
      <h2 id="collection-heading" className="mb-4 text-sm font-semibold text-gray-900">
        Cobrança
      </h2>
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            {
              label: 'Status',
              value: <FinanceStatusBadge status={collection.status} labels={COLLECTION_STATUS_LABELS} />,
            },
            { label: 'Aberta em', value: <DateTime value={collection.openedAt} /> },
            { label: 'Promessa até', value: collection.promisedDueDate ?? '—' },
            { label: 'Versão', value: String(collection.version) },
          ]}
        />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CreateRecordForm
          title="Registrar ação"
          description="Tipos aceitos pelo servidor: CONTACT e NOTICE."
          submitLabel="Registrar ação"
          disabled={closed}
          mapError={mapFinanceErrorToMessage}
          onSubmit={async (idempotencyKey) => {
            afterChildChange(
              await recordCollectionAction(collection.id, {
                kind,
                notes: notes.trim() || undefined,
                idempotencyKey,
              }),
            );
          }}
        >
          <Field label="Tipo" htmlFor="collection-kind" required>
            <Select id="collection-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="CONTACT">Contato</option>
              <option value="NOTICE">Notificação</option>
            </Select>
          </Field>
          <Field label="Notas" htmlFor="collection-notes">
            <Input id="collection-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </CreateRecordForm>
        <CreateRecordForm
          title="Promessa de pagamento"
          description="Valor e data são validados pelo servidor."
          submitLabel="Registrar promessa"
          disabled={closed}
          mapError={mapFinanceErrorToMessage}
          onSubmit={async (idempotencyKey) => {
            afterChildChange(
              await recordCollectionPromise(collection.id, {
                promisedAmount: promisedAmount.trim(),
                promisedOn: promisedOn.trim(),
                idempotencyKey,
              }),
            );
          }}
        >
          <Field label="Valor prometido" htmlFor="collection-promise-amount" required>
            <Input
              id="collection-promise-amount"
              inputMode="decimal"
              value={promisedAmount}
              onChange={(event) => setPromisedAmount(event.target.value)}
              required
            />
          </Field>
          <Field label="Data da promessa" htmlFor="collection-promise-on" required>
            <Input
              id="collection-promise-on"
              type="date"
              value={promisedOn}
              onChange={(event) => setPromisedOn(event.target.value)}
              required
            />
          </Field>
        </CreateRecordForm>
      </div>
      {collection.actions.length === 0 ? (
        <EmptyState title="Sem ações registradas" />
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Ações de cobrança">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>Tipo</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Quando</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Notas</th>
              </tr>
            </thead>
            <tbody>
              {collection.actions.map((action) => (
                <tr key={action.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>{action.kind}</td>
                  <td className={moduleTableCellClass}>
                    <DateTime value={action.occurredAt} />
                  </td>
                  <td className={moduleTableCellClass}>{action.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModuleTableCard>
      )}
      {collection.promises.length > 0 ? (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Promessas de pagamento">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>Data</th>
                <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Valor</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {collection.promises.map((item) => (
                <tr key={item.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <DateTime value={item.promisedOn} mode="date" />
                  </td>
                  <td className={`${moduleTableCellClass} text-right`}>
                    <Money value={item.promisedAmount} />
                  </td>
                  <td className={moduleTableCellClass}>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModuleTableCard>
      ) : null}
    </section>
  );
}
