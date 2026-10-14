import { useCallback, useId, useState } from 'react';
import {
  addClientUnit,
  removeClientUnit,
  setClientUnitHeadquarters,
} from '../api/clients-api';
import type { Client } from '../types/client.types';
import {
  addressPurposeLabel,
  formatAddressLine,
  orderClientUnits,
} from '../utils/client-360-presentation';
import { ObjectPanel } from '../../enterprise-object';
import { Button } from '../../ui/Button';
import { StatusBadge } from '../../ui/StatusBadge';
import { cn } from '../../ui/utils/cn';

/**
 * UNIDADES DO CLIENTE — FILIAIS E ESTABELECIMENTOS.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE A UNIDADE É UMA COLEÇÃO, E NÃO UMA COLUNA
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Um Cliente empresarial opera em VÁRIAS unidades. Uma coluna única obrigaria a eleger uma unidade
 * "principal" — eleição que nenhuma fonte confirmada sustenta — e as demais continuariam sem lugar
 * no cadastro. Por isso a unidade é uma RELAÇÃO, e esta seção a torna operável.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A MATRIZ É DADO DECLARADO, NUNCA DEDUZIDO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Nada aqui infere matriz de nome, de CNPJ ou de ordem de cadastro. "Marcar como matriz" é um
 * COMANDO do operador, e o servidor garante (índice parcial no banco) que existe no máximo uma por
 * Cliente. Quando o operador marca uma segunda, o servidor troca a anterior — operação atômica que
 * a UI não tenta reproduzir.
 *
 * `addressCount` vem CALCULADO do servidor: o frontend não soma coleções para produzir número.
 */

export type ClientUnitsPanelProps = {
  client: Client;
  canManage: boolean;
  onUpdated: (client: Client) => void;
  onError: (message: string) => void;
};

export function ClientUnitsPanel({
  client,
  canManage,
  onUpdated,
  onError,
}: ClientUnitsPanelProps) {
  const units = orderClientUnits(client.units);
  const [busyUnitId, setBusyUnitId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const run = useCallback(
    async (unitId: string, command: () => Promise<Client>) => {
      setBusyUnitId(unitId);
      try {
        onUpdated(await command());
      } catch {
        onError('Não foi possível concluir a ação na unidade.');
      } finally {
        setBusyUnitId(null);
      }
    },
    [onError, onUpdated],
  );

  return (
    <ObjectPanel
      title={`Unidades${units.length > 0 ? ` · ${units.length}` : ''}`}
      actions={
        canManage ? (
          <button
            type="button"
            data-testid="client-unit-add-toggle"
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            onClick={() => setAdding((current) => !current)}
          >
            {adding ? 'Cancelar' : 'Declarar'}
          </button>
        ) : null
      }
    >
      {adding && canManage ? (
        <AddUnitForm
          client={client}
          onCancel={() => setAdding(false)}
          onCreated={(updated) => {
            setAdding(false);
            onUpdated(updated);
          }}
          onError={onError}
        />
      ) : null}

      {units.length === 0 && !adding ? (
        <p className="cisne-type-body m-0 text-gray-500">
          Nenhuma unidade declarada. Endereços podem existir sem unidade.
        </p>
      ) : null}

      {units.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {units.map((unit) => (
            <li
              key={unit.id}
              data-testid="client-unit-row"
              data-unit-headquarters={unit.isHeadquarters}
              className="border-b border-gray-100 pb-1.5 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <strong className="cisne-type-primary min-w-0 truncate">{unit.name}</strong>
                {unit.isHeadquarters ? <StatusBadge label="Matriz" tone="info" /> : null}
                {unit.city || unit.state ? (
                  <span className="cisne-type-helper">
                    {[unit.city, unit.state].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
                {/*
                  CONTAGEM REAL do servidor. Zero é afirmado apenas quando o servidor contou zero —
                  e "0 endereços" É informação útil aqui (a unidade existe sem endereço vinculado).
                */}
                <span className="cisne-type-helper">
                  {unit.addressCount === 0
                    ? 'sem endereço vinculado'
                    : `${unit.addressCount} ${unit.addressCount === 1 ? 'endereço' : 'endereços'}`}
                </span>
              </div>

              {canManage ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {!unit.isHeadquarters ? (
                    <button
                      type="button"
                      data-testid="client-unit-set-headquarters"
                      className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-1.5 text-brand-700 hover:bg-brand-50"
                      disabled={busyUnitId === unit.id}
                      onClick={() =>
                        void run(unit.id, () =>
                          setClientUnitHeadquarters(client.id, unit.id, client.version),
                        )
                      }
                    >
                      Marcar como matriz
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid="client-unit-remove"
                    className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-1.5 text-red-700 hover:bg-red-50"
                    disabled={busyUnitId === unit.id}
                    onClick={() => {
                      /*
                       * A CONFIRMAÇÃO DECLARA A CONSEQUÊNCIA REAL: os endereços da unidade são
                       * DESVINCULADOS, não apagados. Remover uma unidade sem dizer isso faria o
                       * operador temer perder os endereços — ou pior, esperar que sumissem.
                       */
                      if (
                        !window.confirm(
                          `Remover a unidade "${unit.name}"? Os endereços vinculados a ela são preservados no Cliente e ficam sem unidade.`,
                        )
                      ) {
                        return;
                      }
                      void run(unit.id, () => removeClientUnit(client.id, unit.id, client.version));
                    }}
                  >
                    Remover
                  </button>
                  {busyUnitId === unit.id ? (
                    <span className="cisne-type-helper">executando…</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </ObjectPanel>
  );
}

function AddUnitForm({
  client,
  onCancel,
  onCreated,
  onError,
}: {
  client: Client;
  onCancel: () => void;
  onCreated: (client: Client) => void;
  onError: (message: string) => void;
}) {
  const nameId = useId();
  const cityId = useId();
  const stateId = useId();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [isHeadquarters, setIsHeadquarters] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0;

  async function submit() {
    if (!canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const updated = await addClientUnit(client.id, {
        version: client.version,
        name: name.trim(),
        isHeadquarters,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
      });
      onCreated(updated);
    } catch {
      onError('Não foi possível declarar a unidade.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="client-unit-add-form"
      className="mb-2 flex flex-col gap-1.5 border border-gray-200 bg-gray-50/60 p-2"
    >
      <div className="grid gap-1.5 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">Nome da unidade</span>
          <input
            id={nameId}
            data-testid="client-unit-name"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            value={name}
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">Município</span>
          <input
            id={cityId}
            data-testid="client-unit-city"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            value={city}
            disabled={submitting}
            onChange={(event) => setCity(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">UF</span>
          <input
            id={stateId}
            data-testid="client-unit-state"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            maxLength={2}
            value={state}
            disabled={submitting}
            onChange={(event) => setState(event.target.value.toUpperCase())}
          />
        </label>
      </div>

      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          data-testid="client-unit-headquarters"
          checked={isHeadquarters}
          disabled={submitting}
          onChange={(event) => setIsHeadquarters(event.target.checked)}
        />
        <span className="cisne-type-helper">
          Esta é a matriz (uma por Cliente; marcar outra troca a anterior)
        </span>
      </label>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="primary"
          loading={submitting}
          loadingText="Declarando…"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Declarar unidade
        </Button>
        <button
          type="button"
          className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * ENDEREÇOS DO CLIENTE, COM A UNIDADE RESOLVIDA.
 *
 * O endereço continua sendo do CLIENTE: `unitName` apenas qualifica a que estabelecimento ele
 * pertence. Endereço sem unidade é o caso normal e NÃO é defeito — a seção não afirma nada sobre
 * ele além do que o servidor publicou.
 */
export function ClientAddressesPanel({ client }: { client: Client }) {
  /*
   * AUSÊNCIA DA COLEÇÃO = COLEÇÃO VAZIA. `addresses` pode não vir numa resposta gravada antes da
   * migration 0097 (cache, fixture, servidor em versão anterior durante o deploy). Ler a coleção
   * por um acessor que tolera `undefined` mantém a ficha viva em vez de derrubá-la por causa de um
   * painel auxiliar.
   */
  const addresses = client.addresses ?? [];
  return (
    <ObjectPanel title={`Endereços${addresses.length > 0 ? ` · ${addresses.length}` : ''}`}>
      {addresses.length === 0 ? (
        <p className="cisne-type-body m-0 text-gray-500">Nenhum endereço cadastrado.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {addresses.map((address) => (
            <li
              key={address.id ?? `${address.purpose}-${address.postalCode ?? ''}`}
              data-testid="client-address-row"
              className={cn('border-b border-gray-100 pb-1.5 last:border-b-0 last:pb-0')}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <strong className="cisne-type-meta">{addressPurposeText(address.purpose)}</strong>
                {address.unitName ? (
                  <span className="cisne-type-helper">{address.unitName}</span>
                ) : null}
              </div>
              {addressLine(address) ? (
                <p className="cisne-type-helper m-0 truncate">{addressLine(address)}</p>
              ) : null}
              {address.postalCode ? (
                <p className="cisne-type-helper m-0">CEP {address.postalCode}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </ObjectPanel>
  );
}

/* Reexportado de `client-360-presentation` para manter a leitura do painel em um lugar só. */
function addressPurposeText(purpose: string): string {
  return addressPurposeLabel(purpose) ?? purpose;
}

function addressLine(address: Client['addresses'][number]): string | null {
  return formatAddressLine(address);
}
