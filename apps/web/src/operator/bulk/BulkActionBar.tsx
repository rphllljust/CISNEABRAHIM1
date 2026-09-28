import type { ReactNode } from 'react';
import { cn } from '../../ui/utils/cn';

/**
 * BULK ACTION BAR — barra de acoes em lote.
 *
 * DOUTRINA DE SEGURANCA DO BULK NO CISNE
 * ------------------------------------------------------------------------
 * Uma acao em lote so entra nesta barra se TODAS forem verdadeiras:
 *
 *  1. NAO altera estado de dominio. Exportar, navegar, copiar referencia e
 *     marcar contexto local reordenam/apresentam dado ja autorizado; nao
 *     escrevem nada.
 *  2. NAO substitui autorizacao. Nenhuma acao aqui aprova, liquida, concilia,
 *     cancela, transmite nem fecha periodo.
 *  3. Segregação de funcoes (SoD) nao se aplica porque nao ha transicao.
 *
 * Transicoes sensiveis (financeiro, fiscal, contabil, aprovacoes) NAO entram
 * em lote. Elas tem regra por registro, SoD, idempotencia e janela transacional
 * propria — um botao "aplicar em massa" as burlaria. Essas permanecem PARK.
 *
 * BULK NAO E UM ATALHO PARA A REGRA. BULK E UM ATALHO PARA ORGANIZAR O TRABALHO.
 */

export type BulkAction = {
  id: string;
  label: string;
  /** Somente acoes nao-mutantes. Ver doutrina acima. */
  run: (selectedIds: string[]) => void;
  /** Desabilita sem esconder, explicando o motivo ao operador. */
  disabled?: boolean;
  disabledReason?: string;
};

export type BulkActionBarProps = {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
  /** Total de linhas visiveis, para o operador saber o recorte real. */
  visibleCount: number;
  onSelectAllVisible?: () => void;
  /** Acoes sensiveis conhecidas, exibidas como PARK — honestidade operacional. */
  parkedNote?: ReactNode;
  className?: string;
};

export function BulkActionBar({
  count,
  actions,
  onClear,
  visibleCount,
  onSelectAllVisible,
  parkedNote,
  className,
}: BulkActionBarProps) {
  if (count === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5 text-[11px] text-gray-400',
          className,
        )}
      >
        <span>
          {visibleCount} registro{visibleCount === 1 ? '' : 's'} no recorte atual. Marque para agir em
          lote.
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-brand-200 bg-brand-50 px-3 py-2',
        className,
      )}
      role="region"
      aria-label={`${count} registros selecionados`}
    >
      <span className="text-xs font-semibold text-brand-900 tabular-nums">
        {count} selecionado{count === 1 ? '' : 's'}
      </span>

      {onSelectAllVisible ? (
        <button
          type="button"
          className="rounded border border-brand-300 bg-white px-2 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100"
          onClick={onSelectAllVisible}
        >
          Selecionar os {visibleCount} do recorte
        </button>
      ) : null}

      <span className="mx-1 h-4 w-px bg-brand-200" aria-hidden />

      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={action.disabled}
          title={action.disabled ? action.disabledReason : undefined}
          onClick={() => action.run([])}
        >
          {action.label}
        </button>
      ))}

      <button
        type="button"
        className="ml-auto rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white hover:text-gray-800"
        onClick={onClear}
      >
        Limpar seleção
      </button>

      {parkedNote ? (
        <p className="w-full text-[11px] leading-tight text-brand-800/80">{parkedNote}</p>
      ) : null}
    </div>
  );
}

/**
 * Exporta as linhas SELECIONADAS a partir do payload ja carregado.
 *
 * Nao chama a API. O arquivo contem exatamente o que o operador ja estava
 * autorizado a ver na tela. Sem essa premissa, exportacao em lote seria vazamento.
 */
export function exportSelectionToCsv(
  fileName: string,
  headers: string[],
  rows: string[][],
): void {
  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((line) => line.map(escape).join(';')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
