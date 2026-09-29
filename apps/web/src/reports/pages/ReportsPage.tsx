import { useSearchParams } from 'react-router-dom';
import { useReportsCenter } from '../hooks/useReportsCenter';
import { presentReportCell } from '../utils/report-cell-presenter';
import {
  EmptyState,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ReportField,
  ReportJobStatus,
  ReportPreview,
  ReportToolbar,
  ReportWorkbenchHeader,
  reportSelectClass,
  worklistCellClass,
  worklistHeadCellClass,
  worklistNumericHeadCellClass,
  worklistTableCardClass,
  worklistTableClass,
  worklistRowClass,
} from '../../ui';
import { useOperationalUnits, OperationalUnitOptions } from '../../shell/hooks/useOperationalUnits';
import type { ReportExportSummary } from '../types/reports.types';

/**
 * RELATORIOS — mesa de trabalho, nao formulario de consulta.
 *
 * A tela anterior era `.reports-page` (max-width 1100px) + `.reports-layout`
 * (`minmax(240px,280px) 1fr`): um cartao de selecao a esquerda e a previa espremida ao lado. O
 * unico conteudo real da tela — a grade — nascia estreita em qualquer monitor, e a primeira dobra
 * era um seletor. Pior: as celulas passavam por `formatCell()` generico, entao o operador lia
 * `unit-synthetic-homolog`, `COMPLETED`, `CANCELLED`, `RELEASED`, `PREPARED` — identificador
 * interno de ambiente e enums de dominio apresentados como se fossem texto para humano.
 *
 * O que muda aqui:
 * - moldura de workbench: cabecalho + toolbar horizontal + previa na largura principal;
 * - apresentacao SEMANTICA por coluna (`presentReportCell`), usando os dicionarios REAIS do
 *   dominio dono de cada relatorio — unidade declara escopo em vez de repetir slug interno,
 *   status de OS/medicao/faturamento vem do mapa do proprio modulo;
 * - status do job de exportacao junto da acao que o disparou, em vez de fora do campo de visao;
 * - filtro de unidade humano (`useOperationalUnits`), nunca campo de identificador digitado;
 * - estados de carga/negado/erro/vazio pelos primitivos compartilhados.
 *
 * Contrato preservado: mesmo hook, mesmos filtros enviados a API, mesma ordem de colunas, mesmas
 * acoes (gerar/baixar/cancelar) e a mesma consulta autorizada por `unitId`.
 */
export function ReportsPage() {
  const {
    state,
    selectedCatalogItem,
    setSelectedReportType,
    setFilters,
    generateExport,
    downloadExport,
    cancelExport,
    reload,
  } = useReportsCenter();
  const [searchParams] = useSearchParams();
  const { options, unitId, setUnitId } = useOperationalUnits();

  // O filtro de unidade continua sendo enviado como `unitId` (valor real do contrato). A URL pode
  // trazer um recorte de outra superficie; ela vence para nao contradizer o que o operador clicou.
  const activeUnitId =
    searchParams.get('unitId') ?? (state.phase === 'ready' ? (state.filters.unitId ?? unitId) : unitId);

  if (state.phase === 'loading') {
    return (
      <ModulePage>
        <ReportWorkbenchHeader
          title="Relatórios"
          description="Exportações auditáveis do estado real da operação."
        />
        <ModuleLoadingState message="Carregando catálogo de relatórios…" />
      </ModulePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModulePage>
        <ReportWorkbenchHeader
          title="Relatórios"
          description="Exportações auditáveis do estado real da operação."
        />
        <ModuleDeniedState
          title="Relatórios"
          message="Você não tem permissão para gerar relatórios."
        />
      </ModulePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModulePage>
        <ReportWorkbenchHeader
          title="Relatórios"
          description="Exportações auditáveis do estado real da operação."
        />
        <ModuleErrorState
          title="Relatórios"
          message={state.message}
          retryable
          onRetry={() => void reload()}
        />
      </ModulePage>
    );
  }

  const columns = state.preview?.contract.columns ?? selectedCatalogItem?.columns ?? [];
  const rows = state.preview?.preview ?? [];
  const rowKeys = rows[0] ? Object.keys(rows[0]) : [];
  const total = state.preview?.total ?? 0;
  const exportJob = state.exportJob;
  const reportType = state.selectedReportType;

  return (
    <ModulePage>
      <ReportWorkbenchHeader
        title="Relatórios"
        description="Exportações auditáveis do estado real da operação. A prévia é limitada; o arquivo traz o recorte completo."
        action={
          <>
            {exportJob ? <ExportJobIndicator job={exportJob} /> : null}
            <button
              type="button"
              onClick={() => void generateExport()}
              disabled={state.generating}
              className="inline-flex min-h-8 items-center rounded-md border border-brand-600 bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state.generating ? 'Gerando…' : 'Gerar exportação'}
            </button>
            {exportJob?.downloadReady ? (
              <button
                type="button"
                onClick={() => void downloadExport()}
                disabled={state.downloadBusy}
                className="inline-flex min-h-8 items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state.downloadBusy ? 'Baixando…' : 'Baixar CSV'}
              </button>
            ) : null}
            {exportJob && !exportJob.downloadReady && exportJob.status !== 'FAILED' && exportJob.status !== 'CANCELLED' ? (
              <button
                type="button"
                onClick={() => void cancelExport()}
                className="inline-flex min-h-8 items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancelar
              </button>
            ) : null}
          </>
        }
      />

      <ReportToolbar
        meta={
          selectedCatalogItem?.sensitive
            ? 'Exportação sensível — registrada em auditoria'
            : undefined
        }
      >
        <ReportField label="Tipo" htmlFor="report-type">
          <select
            id="report-type"
            className={reportSelectClass}
            value={state.selectedReportType}
            onChange={(event) => setSelectedReportType(event.target.value)}
          >
            {state.catalog.map((item) => (
              <option key={item.reportType} value={item.reportType}>
                {item.label}
              </option>
            ))}
          </select>
        </ReportField>

        <ReportField label="Período" htmlFor="report-period">
          <select
            id="report-period"
            className={reportSelectClass}
            value={state.filters.period ?? 'month'}
            onChange={(event) => setFilters({ period: event.target.value })}
          >
            <option value="week">Semana</option>
            <option value="month">Mês</option>
            <option value="quarter">Trimestre</option>
            <option value="year">Ano</option>
          </select>
        </ReportField>

        {/*
          UNIDADE HUMANA: o filtro anterior era `<input type="text">` pedindo o identificador
          tecnico digitado a mao — o operador tinha que saber `unit-synthetic-homolog` de cor. O
          valor enviado a API continua sendo o identificador real; o que sai e a digitacao dele.
        */}
        <ReportField label="Unidade" htmlFor="report-unit">
          <select
            id="report-unit"
            className={reportSelectClass}
            value={activeUnitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setFilters({ unitId: event.target.value || undefined });
            }}
          >
            <OperationalUnitOptions options={options} includeAllLabel="Todas as unidades" />
          </select>
        </ReportField>
      </ReportToolbar>

      <ReportPreview
        meta={
          state.previewLoading
            ? 'Atualizando prévia…'
            : `Até ${rows.length} de ${total} linhas${state.preview?.contract.timezone ? ` · ${state.preview.contract.timezone}` : ''}`
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title={state.previewLoading ? 'Carregando pré-visualização…' : 'Nenhum dado para os filtros atuais'}
            description={
              state.previewLoading
                ? undefined
                : 'O relatório selecionado não devolveu linhas no recorte aplicado. A exportação respeita exatamente estes filtros.'
            }
          />
        ) : (
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Pré-visualização do relatório selecionado">
              <caption className="sr-only">Pré-visualização do relatório selecionado</caption>
              <thead>
                <tr>
                  {rowKeys.map((key, columnIndex) => (
                    <th
                      key={key}
                      scope="col"
                      className={
                        isNumericColumn(rows, key)
                          ? worklistNumericHeadCellClass
                          : worklistHeadCellClass
                      }
                    >
                      {columns[columnIndex] ?? key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className={worklistRowClass}>
                    {rowKeys.map((key) => {
                      const presented = presentReportCell(reportType, key, row[key]);
                      return (
                        <td
                          key={`${index}-${key}`}
                          className={
                            isNumericColumn(rows, key) ? worklistNumericHeadCellClass : worklistCellClass
                          }
                          title={presented.humanized && presented.raw ? `Valor original: ${presented.raw}` : undefined}
                        >
                          {presented.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportPreview>
    </ModulePage>
  );
}

/** Coluna numerica alinha a direita: valor comparavel se le em coluna. */
function isNumericColumn(rows: Record<string, unknown>[], key: string): boolean {
  return rows.every((row) => typeof row[key] === 'number');
}

/**
 * STATUS DO JOB — junto da acao, nao depois da tabela.
 *
 * Antes esse bloco vivia abaixo da previa com `margin-top` inline: o operador disparava a
 * exportacao e o retorno aparecia fora da tela. Aqui ele e um selo ao lado do botao, com o mesmo
 * vocabulario humano do dominio.
 */
function ExportJobIndicator({ job }: { job: ReportExportSummary }) {
  if (job.status === 'PENDING' || job.status === 'RUNNING') {
    return (
      <ReportJobStatus>
        <span aria-hidden="true">⏳</span>
        <span>Gerando em segundo plano…</span>
      </ReportJobStatus>
    );
  }
  if (job.status === 'COMPLETED') {
    return (
      <ReportJobStatus tone="success">
        <span>
          Concluída — {job.rowCount ?? 0} linhas
          {job.fileSizeBytes ? ` (${Math.round(job.fileSizeBytes / 1024)} KB)` : ''}
        </span>
      </ReportJobStatus>
    );
  }
  if (job.status === 'FAILED') {
    return (
      <ReportJobStatus tone="critical">
        <span>Falha: {job.errorMessage ?? 'erro desconhecido'}</span>
      </ReportJobStatus>
    );
  }
  if (job.status === 'CANCELLED') {
    return (
      <ReportJobStatus>
        <span>Cancelada</span>
      </ReportJobStatus>
    );
  }
  return null;
}
