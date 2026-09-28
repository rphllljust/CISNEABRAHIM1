import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Input, Money } from '../../ui';
import {
  FilterCard,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  ModuleTableLink,
  filterControlClass,
  filterLabelClass,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { ProcessingBanner } from '../../financial-ui/ProcessingBanner';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  getTaxCalculation,
  listTaxCalculations,
  reproduceTaxCalculation,
  type TaxCalculationSummary,
} from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import type { TaxCalculation, TaxReproduction } from '../types/fiscal.types';

/**
 * Apuração. Antes era consulta por identificador digitado. Agora a apuração é ENCONTRADA por
 * regra, versão, base/resultado e origem — e o detalhe é acessado pela lista.
 */
export function FiscalApuracaoPage() {
  const { calculationId = '' } = useParams();
  const [activeId, setActiveId] = useState(calculationId);
  const [reproduction, setReproduction] = useState<TaxReproduction | null>(null);
  const [processing, setProcessing] = useState(false);
  const inflight = useRef(false);
  const [unitId, setUnitId] = useState('');
  const [term, setTerm] = useState('');
  const [applied, setApplied] = useState<{ unitId: string; q: string } | null>(null);
  const [items, setItems] = useState<TaxCalculationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [listPhase, setListPhase] = useState<'idle' | 'loading' | 'ready' | 'denied' | 'error'>('idle');

  const loader = useCallback((signal?: AbortSignal) => getTaxCalculation(activeId, signal), [activeId]);
  const { state, reload } = useBackofficeQuery<TaxCalculation>({
    loader,
    mapError: mapFiscalErrorToMessage,
    enabled: Boolean(activeId),
    autoLoad: Boolean(activeId),
  });

  useEffect(() => {
    if (!applied) {
      return;
    }
    const controller = new AbortController();
    setListPhase('loading');
    void listTaxCalculations(
      { unitId: applied.unitId, q: applied.q || undefined, limit: 20, offset: 0 },
      controller.signal,
    )
      .then((response) => {
        setItems(response.items);
        setTotal(response.total);
        setListPhase('ready');
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
        setListPhase('denied');
      });
    return () => controller.abort();
  }, [applied]);

  const gate = activeId
    ? renderQueryGate(
        'Apuração',
        'Carregando apuração…',
        'Você não tem permissão para consultar apurações fiscais.',
        state,
        () => void reload(),
      )
    : null;

  async function handleReproduce() {
    if (!activeId || inflight.current) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    try {
      setReproduction(await reproduceTaxCalculation(activeId));
    } finally {
      inflight.current = false;
      setProcessing(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader
        title="Apuração"
        description="A apuração é encontrada por regra, versão e resultado. Reprodução vem do motor versionado; esta tela não calcula imposto."
      />

      <FilterCard>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setActiveId('');
            setReproduction(null);
            setApplied({ unitId: unitId.trim(), q: term.trim() });
          }}
        >
          <div>
            <label className={filterLabelClass} htmlFor="apuracao-unit">
              Unidade
            </label>
            <Input
              id="apuracao-unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              required
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="apuracao-search">
              Buscar
            </label>
            <input
              id="apuracao-search"
              type="search"
              className={`${filterControlClass} w-72`}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Regra, nome ou origem"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Buscar
          </button>
        </form>
        {listPhase === 'denied' ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            Você não tem permissão para listar apurações desta unidade.
          </p>
        ) : null}
      </FilterCard>

      {listPhase === 'loading' ? <ModuleLoadingState title="Apuração" message="Carregando apurações…" /> : null}

      {listPhase === 'ready' && items.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          Nenhuma apuração encontrada para esta unidade.
        </p>
      ) : null}

      {listPhase === 'ready' && items.length > 0 ? (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de Apurações">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>Regra</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Versão</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Origem</th>
                <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Base</th>
                <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((calculation) => (
                <tr key={calculation.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink
                      to={`/app/fiscal/apuracao/${calculation.id}`}
                      onClick={() => {
                        setActiveId(calculation.id);
                        setReproduction(null);
                      }}
                    >
                      {calculation.ruleName}
                    </ModuleTableLink>
                    <span className="block text-xs text-gray-500">{calculation.ruleCode}</span>
                  </td>
                  <td className={moduleTableCellClass}>{calculation.versionNumber}</td>
                  <td className={moduleTableCellClass}>{calculation.sourceKind ?? '—'}</td>
                  <td className={`${moduleTableCellClass} text-right`}>
                    <Money value={calculation.baseAmount} />
                  </td>
                  <td className={`${moduleTableCellClass} text-right`}>
                    <Money value={calculation.resultAmount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModuleTableCard>
      ) : null}

      {listPhase === 'ready' ? (
        <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
          {total} apuração(ões) no total.
        </p>
      ) : null}

      {gate}
      {state.phase === 'ready' ? (
        <>
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                { label: 'Regra', value: state.data.ruleCode },
                { label: 'Versão', value: String(state.data.versionNumber) },
                { label: 'Base', value: <Money value={state.data.baseAmount} /> },
                { label: 'Alíquota persistida', value: state.data.rate ?? '—' },
                { label: 'Resultado', value: <Money value={state.data.resultAmount} emphasis /> },
              ]}
            />
          </div>
          <div className="mb-4">
            <Button type="button" onClick={() => void handleReproduce()} loading={processing} disabled={processing}>
              Reproduzir no servidor
            </Button>
          </div>
          {processing ? <div className="mb-4"><ProcessingBanner /></div> : null}
          {reproduction ? (
            <p className="mb-4 text-sm" role="status">
              Reprodução {reproduction.matches ? 'coincide' : 'diverge'} do resultado persistido. Valor recompute:{' '}
              <Money value={reproduction.recomputed.resultAmount} />
            </p>
          ) : null}
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Linhas da apuração">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>Componente</th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Base</th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {state.data.lines.map((line) => (
                  <tr key={line.lineNumber} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>{line.componentLabel}</td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      <Money value={line.baseAmount} />
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      <Money value={line.resultAmount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModuleTableCard>
        </>
      ) : null}
    </ModulePage>
  );
}
