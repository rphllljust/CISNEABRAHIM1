import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { DateTime, EmptyState, Money } from '../../ui';
import {
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { RECEIVABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import { cancelReceivable, getReceivable, settleReceivable } from '../api/finance-api';
import { CollectionPanel } from '../components/CollectionPanel';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type { ReceivableDetail } from '../types/finance.types';

/**
 * Histórico do título a partir de FATOS PERSISTIDOS apenas.
 *
 * O payload de recebíveis não guarda trilha de eventos nem ator: guarda
 * `createdAt`, `updatedAt`, `cancelledAt` e as liquidações com `settledAt`.
 * Então é exatamente isso que o histórico mostra — nada de evento inventado,
 * nada de "Sistema" preenchendo autor desconhecido, nada de estado anterior que
 * não foi gravado.
 */
export function receivableActivityFacts(item: ReceivableDetail): ActivityFact[] {
  const facts: ActivityFact[] = [
    { at: item.createdAt, event: 'Título criado' },
    { at: item.updatedAt, event: 'Título atualizado' },
  ];

  if (item.cancelledAt) {
    facts.push({
      at: item.cancelledAt,
      event: 'Título cancelado',
      reference: item.cancelReason ?? null,
    });
  }

  for (const settlement of item.settlements) {
    facts.push({
      at: settlement.settledAt,
      event: 'Recebimento registrado',
      reference: `${settlement.amount} ${settlement.currencyCode} · ${settlement.status}`,
    });
  }

  return facts;
}


export function ReceivableDetailPage() {
  const { receivableId = '' } = useParams();
  const loader = useCallback((signal?: AbortSignal) => getReceivable(receivableId, signal), [receivableId]);
  const { state, reload, setReady } = useBackofficeQuery<ReceivableDetail>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(receivableId),
  });

  const gate = renderQueryGate(
    'Conta a receber',
    'Carregando título…',
    'Você não tem permissão para ver este título.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return (
      <ModulePage>
        <ModulePageHeader title="Conta a receber" />
        <EmptyState title="Informe um título válido" />
      </ModulePage>
    );
  }

  const item = state.data;
  const closed = item.lifecycle === 'CANCELLED' || item.status === 'PAID';

  return (
    <ModulePage>
      <ModulePageHeader
        title={item.externalReference ?? 'Conta a receber'}
        description="Valores, saldo e status são os devolvidos pelo backend."
      />

      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            {
              label: 'Status',
              value: <FinanceStatusBadge status={item.status} labels={RECEIVABLE_STATUS_LABELS} />,
            },
            { label: 'Principal', value: <Money value={item.principal} currencyCode={item.currencyCode} /> },
            {
              label: 'Saldo informado',
              value: <Money value={item.remainingBalance} currencyCode={item.currencyCode} emphasis />,
            },
            { label: 'Recebido', value: <Money value={item.settledAmount} currencyCode={item.currencyCode} /> },
            { label: 'Vencimento', value: <DateTime value={item.dueDate} mode="date" /> },
            { label: 'Condição', value: item.paymentTerms },
            { label: 'Versão', value: String(item.rowVersion) },
            { label: 'Cliente', value: item.clientId },
          ]}
        />
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <ActivityTimeline
          facts={receivableActivityFacts(item)}
          emptyMessage="Este título não expõe histórico persistido além dos timestamps abaixo."
        />
      </div>

      <ModuleTableCard>
        <table className={moduleTableClass} aria-label="Parcelas do título">
          <thead className={moduleTableHeadClass}>
            <tr>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Parcela
              </th>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Vencimento
              </th>
              <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                Principal
              </th>
            </tr>
          </thead>
          <tbody>
            {item.installments.map((installment) => (
              <tr key={installment.id} className={moduleTableRowClass}>
                <td className={moduleTableCellClass}>{installment.installmentNumber}</td>
                <td className={moduleTableCellClass}>
                  <DateTime value={installment.dueDate} mode="date" />
                </td>
                <td className={`${moduleTableCellClass} text-right`}>
                  <Money value={installment.principal} currencyCode={item.currencyCode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ModuleTableCard>

      <CollectionPanel
        key={item.rowVersion}
        receivableId={item.id}
        receivable={item}
        onChanged={() => void reload()}
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MoneyActionForm
          title="Registrar recebimento"
          description="O servidor valida o valor, a versão e a idempotência."
          confirmTitle="Confirmar recebimento"
          confirmDescription="O valor informado será enviado ao backend. Nada é calculado neste formulário."
          confirmLabel="Receber"
          amountLabel="Valor"
          disabled={closed}
          mapError={mapFinanceErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async ({ amount, idempotencyKey }) => {
            const next = await settleReceivable(item.id, {
              amount: amount ?? '',
              rowVersion: item.rowVersion,
              idempotencyKey,
            });
            setReady(next);
          }}
        />
        <MoneyActionForm
          title="Cancelar título"
          description="O cancelamento exige justificativa e é decidido pelo servidor."
          confirmTitle="Cancelar título"
          confirmDescription="O título será cancelado apenas se o backend aceitar a operação."
          confirmLabel="Cancelar título"
          reasonLabel="Justificativa"
          disabled={closed}
          mapError={mapFinanceErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const next = await cancelReceivable(item.id, {
              rowVersion: item.rowVersion,
              cancelReason: reason ?? '',
              idempotencyKey,
            });
            setReady(next);
          }}
        />
      </div>
    </ModulePage>
  );
}
