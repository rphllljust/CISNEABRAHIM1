import { useCallback, useState } from 'react';
import { Checkbox, EmptyState, Field, Input, Money, Select } from '../../ui';
import { ModulePage, ModulePagination, filterControlClass } from '../../ui/module-layout';
import {
  RecordStatusCell,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { CreateRecordForm } from '../../financial-ui/VersionedActionForm';
import { TREASURY_KIND_LABELS, TREASURY_LIFECYCLE_LABELS } from '../../financial-ui/labels';
import { sliceTablePage, tablePageCount } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { listTreasuryAccounts, openTreasuryAccount } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type { FinancialAccount } from '../types/finance.types';

type AccountDraft = {
  unitId: string;
  kind: string;
  code: string;
  name: string;
  currencyCode: string;
  openingAmount: string;
  overdraftAllowed: boolean;
  bankCode: string;
  agency: string;
  accountNumber: string;
  locationCode: string;
};

const EMPTY_DRAFT: AccountDraft = {
  unitId: '',
  kind: 'CASH',
  code: '',
  name: '',
  currencyCode: 'BRL',
  openingAmount: '',
  overdraftAllowed: false,
  bankCode: '',
  agency: '',
  accountNumber: '',
  locationCode: '',
};

export function TreasuryListPage() {
  const [pageNumber, setPageNumber] = useState(1);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const loader = useCallback((signal?: AbortSignal) => listTreasuryAccounts(signal), []);
  const { state, reload } = useBackofficeQuery<FinancialAccount[]>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const gate = renderQueryGate(
    'Caixa e bancos',
    'Carregando contas financeiras…',
    'Você não tem permissão para listar caixa e bancos.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return null;
  }

  const pageCount = tablePageCount(state.data.length);
  const pageItems = sliceTablePage(state.data, Math.min(pageNumber, pageCount));
  const isBank = draft.kind === 'BANK';

  return (
    <ModulePage>
      <WorklistHeader
        title="Caixa e bancos"
        count={state.data.length}
        context="O saldo de cada conta é o valor reconstruído pelo servidor. Esta tela não soma nem recalcula."
      />

      <CreateRecordForm
        title="Abrir conta financeira"
        description="A abertura é decidida pelo backend: tipo, moeda, conta bancária ou localização de caixa."
        submitLabel="Abrir conta"
        mapError={mapFinanceErrorToMessage}
        onConflictReload={() => void reload()}
        onSuccess={() => {
          setDraft(EMPTY_DRAFT);
          void reload();
        }}
        onSubmit={async (_idempotencyKey) => {
          await openTreasuryAccount({
            unitId: draft.unitId.trim(),
            kind: draft.kind,
            code: draft.code.trim(),
            name: draft.name.trim(),
            currencyCode: draft.currencyCode.trim().toUpperCase(),
            overdraftAllowed: draft.overdraftAllowed,
            openingAmount: draft.openingAmount.trim() || undefined,
            ...(isBank
              ? {
                  bank: {
                    bankCode: draft.bankCode.trim(),
                    agency: draft.agency.trim(),
                    accountNumber: draft.accountNumber.trim(),
                  },
                }
              : { cash: { locationCode: draft.locationCode.trim() } }),
          });
        }}
      >
        <Field label="Unidade" htmlFor="account-unit" required>
          <Input
            id="account-unit"
            value={draft.unitId}
            onChange={(event) => setDraft((current) => ({ ...current, unitId: event.target.value }))}
            required
          />
        </Field>
        <Field label="Tipo" htmlFor="account-kind" required>
          <Select
            id="account-kind"
            value={draft.kind}
            onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}
          >
            <option value="CASH">Caixa</option>
            <option value="BANK">Conta bancária</option>
          </Select>
        </Field>
        <Field label="Código" htmlFor="account-code" required>
          <Input
            id="account-code"
            value={draft.code}
            onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
            required
          />
        </Field>
        <Field label="Nome" htmlFor="account-name" required>
          <Input
            id="account-name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            required
          />
        </Field>
        <Field label="Moeda" htmlFor="account-currency" required>
          <Input
            id="account-currency"
            value={draft.currencyCode}
            onChange={(event) => setDraft((current) => ({ ...current, currencyCode: event.target.value }))}
            required
          />
        </Field>
        <Field label="Saldo inicial (opcional)" htmlFor="account-opening" hint="Valor positivo validado pelo servidor.">
          <Input
            id="account-opening"
            inputMode="decimal"
            value={draft.openingAmount}
            onChange={(event) => setDraft((current) => ({ ...current, openingAmount: event.target.value }))}
          />
        </Field>
        <Field label="Permitir saldo negativo" htmlFor="account-overdraft" className="md:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <Checkbox
              id="account-overdraft"
              checked={draft.overdraftAllowed}
              onChange={(event) => setDraft((current) => ({ ...current, overdraftAllowed: event.target.checked }))}
            />
            Cheque especial / limite de caixa
          </label>
        </Field>
        {isBank ? (
          <>
            <Field label="Banco (código)" htmlFor="account-bank-code" required>
              <Input
                id="account-bank-code"
                className={filterControlClass}
                value={draft.bankCode}
                onChange={(event) => setDraft((current) => ({ ...current, bankCode: event.target.value }))}
                required
              />
            </Field>
            <Field label="Agência" htmlFor="account-agency" required>
              <Input
                id="account-agency"
                className={filterControlClass}
                value={draft.agency}
                onChange={(event) => setDraft((current) => ({ ...current, agency: event.target.value }))}
                required
              />
            </Field>
            <Field label="Conta" htmlFor="account-number" required className="md:col-span-2">
              <Input
                id="account-number"
                className={filterControlClass}
                value={draft.accountNumber}
                onChange={(event) => setDraft((current) => ({ ...current, accountNumber: event.target.value }))}
                required
              />
            </Field>
          </>
        ) : (
          <Field label="Localização do caixa" htmlFor="account-location" required className="md:col-span-2">
            <Input
              id="account-location"
              className={filterControlClass}
              value={draft.locationCode}
              onChange={(event) => setDraft((current) => ({ ...current, locationCode: event.target.value }))}
              required
            />
          </Field>
        )}
      </CreateRecordForm>

      {state.data.length === 0 ? (
        <EmptyState title="Nenhuma conta financeira" description="O servidor não devolveu contas no seu escopo." />
      ) : (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lista de caixa e bancos">
              <thead>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Conta
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Tipo
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={worklistNumericHeadCellClass}>
                    Saldo do servidor
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((account) => (
                  <tr key={account.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <WorklistRowLink href={`/app/finance/treasury/${account.id}`}>
                        {account.name}
                      </WorklistRowLink>
                      <p className="font-mono text-[11px] text-gray-500">{account.code}</p>
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <RecordStatusCell
                        badge={
                          <FinanceStatusBadge status={account.kind} labels={TREASURY_KIND_LABELS} />
                        }
                      />
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <RecordStatusCell
                        badge={
                          <FinanceStatusBadge
                            status={account.lifecycle}
                            labels={TREASURY_LIFECYCLE_LABELS}
                          />
                        }
                      />
                    </td>
                    <td className={worklistNumericCellClass}>
                      <Money value={account.balance} currencyCode={account.currencyCode} emphasis />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <WorklistFooter
            rangeLabel={`Página ${Math.min(pageNumber, pageCount)} de ${pageCount} · ${state.data.length} contas`}
          >
            <ModulePagination
              pageNumber={Math.min(pageNumber, pageCount)}
              onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
              onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
              previousDisabled={pageNumber <= 1}
              nextDisabled={pageNumber >= pageCount}
            />
          </WorklistFooter>
        </>
      )}
    </ModulePage>
  );
}
