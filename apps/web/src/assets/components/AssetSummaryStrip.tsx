import {
  ASSET_OPERATIONAL_AVAILABILITIES,
  type AssetOperationalAvailability,
  type PhysicalAssetListSummary,
} from '../types/physical-asset.types';
import { formatAssetCount } from '../utils/asset-operational-status';
import { cn } from '../../ui/utils/cn';

type AssetSummaryMetric = {
  id: string;
  label: string;
  value: number | null;
  filterAvailability: '' | AssetOperationalAvailability;
  ariaLabel: string;
};

type AssetSummaryStripProps = {
  summary: PhysicalAssetListSummary | null;
  activeAvailabilityFilter: '' | AssetOperationalAvailability;
  onSelectAvailability: (availability: '' | AssetOperationalAvailability) => void;
};

export function AssetSummaryStrip({
  summary,
  activeAvailabilityFilter,
  onSelectAvailability,
}: AssetSummaryStripProps) {
  const metrics: AssetSummaryMetric[] = [
    {
      id: 'total',
      label: 'Total de ativos',
      value: summary?.total ?? null,
      filterAvailability: '',
      ariaLabel: 'Mostrar todos os ativos',
    },
    {
      id: 'available',
      label: 'Disponíveis',
      value: summary?.available ?? null,
      filterAvailability: ASSET_OPERATIONAL_AVAILABILITIES.Available,
      ariaLabel: 'Filtrar ativos disponíveis',
    },
    {
      id: 'allocated',
      label: 'Alocados',
      value: summary?.allocated ?? null,
      filterAvailability: ASSET_OPERATIONAL_AVAILABILITIES.Allocated,
      ariaLabel: 'Filtrar ativos alocados',
    },
    {
      id: 'unavailable',
      label: 'Indisponíveis',
      value: summary?.unavailable ?? null,
      filterAvailability: ASSET_OPERATIONAL_AVAILABILITIES.Unavailable,
      ariaLabel: 'Filtrar ativos indisponíveis',
    },
  ];

  return (
    /*
      RESUMO COMPACTO — indicadores clicaveis na MESMA faixa do cabecalho da worklist.
      Era um cartao `rounded-xl` com sombra que empurrava a toolbar e a grade, gastando um
      terco da largura com quatro numeros. Aqui ele nao abre faixa propria: entra no
      `metrics` do `WorklistHeader`, entao Frota passa a ter a mesma primeira dobra das
      outras quatro. Cada indicador continua sendo um filtro real (`aria-pressed`).
    */
    <section aria-label="Indicadores de frota" className="flex flex-wrap items-center gap-1.5">
      {metrics.map((metric) => {
        const isActive = activeAvailabilityFilter === metric.filterAvailability;
        return (
          <button
            key={metric.id}
            type="button"
            className={cn(
              'inline-flex items-baseline gap-1.5 rounded border px-2 py-0.5 text-xs transition',
              'hover:bg-gray-50 focus-visible:cisne-focus-ring',
              isActive
                ? 'border-brand-200 bg-brand-50'
                : 'border-gray-200 bg-white',
            )}
            aria-label={metric.ariaLabel}
            aria-pressed={isActive}
            onClick={() => onSelectAvailability(metric.filterAvailability)}
          >
            <strong className="text-sm font-semibold tabular-nums text-gray-900">
              {metric.value === null ? '—' : formatAssetCount(metric.value)}
            </strong>
            <span className="font-medium text-gray-600">{metric.label}</span>
          </button>
        );
      })}
    </section>
  );
}
