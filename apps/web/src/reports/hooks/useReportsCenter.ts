import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReportsApiError,
  cancelReportExport,
  createReportExport,
  downloadReportExport,
  getReportCatalog,
  getReportExport,
  previewReport,
} from '../api/reports-api';
import type {
  ReportCatalogItem,
  ReportExportSummary,
  ReportFilters,
  ReportPreviewResponse,
} from '../types/reports.types';

const PREVIEW_DEBOUNCE_MS = 400;
const POLL_INTERVAL_MS = 2_000;

export type ReportsPageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'empty' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      catalog: ReportCatalogItem[];
      selectedReportType: string;
      exportFormat: string;
      filters: ReportFilters;
      preview: ReportPreviewResponse | null;
      previewLoading: boolean;
      previewError: string | null;
      exportJob: ReportExportSummary | null;
      generating: boolean;
      downloadBusy: boolean;
    };

const DEFAULT_FILTERS: ReportFilters = { period: 'month' };

/** Drop filters that the selected backend report contract does not authorize. */
export function compatibleReportFilters(filters: ReportFilters, item: ReportCatalogItem): ReportFilters {
  if (!item.allowedFilters) return filters;
  const result: ReportFilters = {};
  for (const key of item.allowedFilters) {
    const value = filters[key];
    if (value !== undefined) result[key] = value;
  }
  if (item.allowedFilters.includes('period') && !result.period && !result.from && !result.to) {
    result.period = 'month';
  }
  return result;
}

export function useReportsCenter() {
  const [state, setState] = useState<ReportsPageState>({ phase: 'loading' });
  const previewTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const pollAbort = useRef<AbortController | null>(null);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }, []);

  const clearPollTimer = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    pollAbort.current?.abort();
    pollAbort.current = null;
  }, []);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    try {
      const catalog = await getReportCatalog(signal);
      if (signal?.aborted) return;
      if (catalog.length === 0) {
        setState({ phase: 'empty' });
        return;
      }
      setState({
        phase: 'ready',
        catalog,
        selectedReportType: catalog[0]!.reportType,
        exportFormat: catalog[0]!.formats[0] ?? 'CSV',
        filters: compatibleReportFilters(DEFAULT_FILTERS, catalog[0]!),
        preview: null,
        previewLoading: true,
        previewError: null,
        exportJob: null,
        generating: false,
        downloadBusy: false,
      });
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ReportsApiError && error.kind === 'denied') {
        setState({ phase: 'denied' });
        return;
      }
      setState({
        phase: 'error',
        message:
          error instanceof ReportsApiError && error.kind === 'network'
            ? 'Não foi possível carregar os relatórios.'
            : 'Falha ao carregar os relatórios.',
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalog(controller.signal);
    return () => controller.abort();
  }, [loadCatalog]);

  const refreshPreview = useCallback(
    async (reportType: string, filters: ReportFilters) => {
      previewAbort.current?.abort();
      const controller = new AbortController();
      previewAbort.current = controller;
      setState((previous) =>
        previous.phase === 'ready' &&
        previous.selectedReportType === reportType &&
        previous.filters === filters
          ? { ...previous, preview: null, previewLoading: true, previewError: null }
          : previous,
      );
      try {
        const preview = await previewReport(reportType, filters, controller.signal);
        if (controller.signal.aborted) return;
        setState((previous) =>
          previous.phase === 'ready' &&
          previous.selectedReportType === reportType &&
          previous.filters === filters
            ? { ...previous, preview, previewLoading: false, previewError: null }
            : previous,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof ReportsApiError && error.kind === 'denied'
          ? 'Sem permissão para consultar a prévia deste relatório.'
          : 'Falha ao consultar a prévia deste relatório. Tente novamente.';
        setState((previous) =>
          previous.phase === 'ready' &&
          previous.selectedReportType === reportType &&
          previous.filters === filters
            ? { ...previous, preview: null, previewLoading: false, previewError: message }
            : previous,
        );
      }
    },
    [],
  );

  const schedulePreview = useCallback(
    (reportType: string, filters: ReportFilters) => {
      clearPreviewTimer();
      previewTimer.current = window.setTimeout(() => {
        void refreshPreview(reportType, filters);
      }, PREVIEW_DEBOUNCE_MS);
    },
    [clearPreviewTimer, refreshPreview],
  );

  /**
   * PREVIEW DO RELATORIO — disparo por ENTRADA, nao por ESTADO.
   *
   * ANTES: o efeito dependia do objeto `state` inteiro. Cada `setState` do preview
   * (`previewLoading: true`, depois `preview`) re-criava a identidade de `state`, o efeito
   * voltava a rodar e reagendava o debounce — que buscava de novo. O ciclo nunca fechava:
   * abrir a Central de fechamento deixava a rede permanentemente ocupada, o que torna
   * `networkidle` inalcancavel e multiplica chamadas por qualquer tempo de permanencia.
   *
   * AGORA: o efeito observa SOMENTE as entradas que definem o preview (tipo do relatorio,
   * filtros e fase). Reescrever o resultado do preview nao dispara nova busca — a busca e
   * consequencia de mudar a pergunta, nao de mudar a resposta.
   *
   * `state.filters` e identidade estavel por construcao: `setFilters` sempre cria um objeto
   * novo, mas SO quando o operador muda um filtro. Leituras de preview nao tocam em `filters`.
   */
  const previewFilters = state.phase === 'ready' ? state.filters : null;
  const previewReportType = state.phase === 'ready' ? state.selectedReportType : null;

  useEffect(() => {
    if (previewReportType === null || previewFilters === null) {
      return;
    }
    schedulePreview(previewReportType, previewFilters);
    return () => clearPreviewTimer();
  }, [previewReportType, previewFilters, schedulePreview, clearPreviewTimer]);

  const setSelectedReportType = useCallback((reportType: string) => {
    clearPreviewTimer();
    previewAbort.current?.abort();
    setState((previous) => {
      if (previous.phase !== 'ready') return previous;
      const selected = previous.catalog.find((item) => item.reportType === reportType);
      if (!selected) return previous;
      return {
        ...previous,
        selectedReportType: reportType,
        exportFormat: selected.formats.includes(previous.exportFormat)
          ? previous.exportFormat : (selected.formats[0] ?? 'CSV'),
        filters: compatibleReportFilters(previous.filters, selected),
        preview: null,
        previewLoading: true,
        previewError: null,
        exportJob: null,
      };
    });
  }, [clearPreviewTimer]);

  const setExportFormat = useCallback((format: string) => {
    setState((previous) => {
      if (previous.phase !== 'ready') return previous;
      const item = previous.catalog.find((entry) => entry.reportType === previous.selectedReportType);
      if (!item?.formats.includes(format)) return previous;
      return { ...previous, exportFormat: format, exportJob: null };
    });
  }, []);

  const setFilters = useCallback((next: Partial<ReportFilters>) => {
    clearPreviewTimer();
    previewAbort.current?.abort();
    setState((previous) =>
      previous.phase === 'ready'
        ? {
            ...previous,
            filters: compatibleReportFilters(
              { ...previous.filters, ...next },
              previous.catalog.find((item) => item.reportType === previous.selectedReportType)!,
            ),
            preview: null,
            previewLoading: true,
            previewError: null,
            exportJob: null,
          }
        : previous,
    );
  }, [clearPreviewTimer]);

  const retryPreview = useCallback(() => {
    if (state.phase !== 'ready') return;
    clearPreviewTimer();
    void refreshPreview(state.selectedReportType, state.filters);
  }, [state, clearPreviewTimer, refreshPreview]);

  const pollExport = useCallback(
    (exportId: string) => {
      clearPollTimer();
      const controller = new AbortController();
      pollAbort.current = controller;

      const tick = async () => {
        try {
          const job = await getReportExport(exportId, controller.signal);
          setState((previous) =>
            previous.phase === 'ready' ? { ...previous, exportJob: job, generating: !job.downloadReady && job.status !== 'FAILED' && job.status !== 'CANCELLED' } : previous,
          );
          if (job.downloadReady || job.status === 'FAILED' || job.status === 'CANCELLED') {
            clearPollTimer();
          }
        } catch {
          clearPollTimer();
        }
      };

      void tick();
      pollTimer.current = window.setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    },
    [clearPollTimer],
  );

  const generateExport = useCallback(async () => {
    if (state.phase !== 'ready') {
      return;
    }
    setState((previous) =>
      previous.phase === 'ready' ? { ...previous, generating: true, exportJob: null } : previous,
    );
    try {
      const job = await createReportExport(state.selectedReportType, state.filters, state.exportFormat);
      setState((previous) =>
        previous.phase === 'ready' ? { ...previous, exportJob: job, generating: !job.downloadReady } : previous,
      );
      if (!job.downloadReady) {
        pollExport(job.id);
      } else {
        setState((previous) =>
          previous.phase === 'ready' ? { ...previous, generating: false } : previous,
        );
      }
    } catch (error) {
      setState((previous) =>
        previous.phase === 'ready'
          ? {
              ...previous,
              generating: false,
              exportJob: {
                id: 'local-error',
                reportType: previous.selectedReportType,
                format: previous.exportFormat,
                status: 'FAILED',
                contract: previous.preview?.contract ?? {
                  name: '',
                  filters: previous.filters,
                  columns: [],
                  sort: { field: '', direction: 'ASC' },
                  timezone: '',
                  generatedAt: null,
                  actor: { identityId: '', sessionId: '' },
                  scope: { summary: '' },
                },
                rowCount: null,
                fileSizeBytes: null,
                errorMessage:
                  error instanceof ReportsApiError ? error.kind : 'Falha ao gerar exportação.',
                createdAt: new Date().toISOString(),
                completedAt: null,
                downloadReady: false,
              },
            }
          : previous,
      );
    }
  }, [pollExport, state]);

  const downloadExport = useCallback(async () => {
    if (state.phase !== 'ready' || !state.exportJob?.downloadReady) {
      return;
    }
    setState((previous) =>
      previous.phase === 'ready' ? { ...previous, downloadBusy: true } : previous,
    );
    try {
      const blob = await downloadReportExport(state.exportJob.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${state.exportJob.reportType.toLowerCase()}.${state.exportJob.format.toLowerCase()}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setState((previous) =>
        previous.phase === 'ready' ? { ...previous, downloadBusy: false } : previous,
      );
    }
  }, [state]);

  const cancelExport = useCallback(async () => {
    if (state.phase !== 'ready' || !state.exportJob) {
      return;
    }
    await cancelReportExport(state.exportJob.id);
    clearPollTimer();
    setState((previous) =>
      previous.phase === 'ready'
        ? {
            ...previous,
            generating: false,
            exportJob: { ...state.exportJob!, status: 'CANCELLED', downloadReady: false },
          }
        : previous,
    );
  }, [clearPollTimer, state]);

  useEffect(() => () => {
    clearPreviewTimer();
    clearPollTimer();
    previewAbort.current?.abort();
  }, [clearPollTimer, clearPreviewTimer]);

  const selectedCatalogItem = useMemo(() => {
    if (state.phase !== 'ready') {
      return null;
    }
    return state.catalog.find((item) => item.reportType === state.selectedReportType) ?? null;
  }, [state]);

  return {
    state,
    selectedCatalogItem,
    setSelectedReportType,
    setExportFormat,
    setFilters,
    retryPreview,
    generateExport,
    downloadExport,
    cancelExport,
    reload: loadCatalog,
  };
}
