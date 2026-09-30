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
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      catalog: ReportCatalogItem[];
      selectedReportType: string;
      filters: ReportFilters;
      preview: ReportPreviewResponse | null;
      previewLoading: boolean;
      exportJob: ReportExportSummary | null;
      generating: boolean;
      downloadBusy: boolean;
    };

const DEFAULT_FILTERS: ReportFilters = { period: 'month' };

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
      if (catalog.length === 0) {
        setState({ phase: 'denied' });
        return;
      }
      setState({
        phase: 'ready',
        catalog,
        selectedReportType: catalog[0]!.reportType,
        filters: DEFAULT_FILTERS,
        preview: null,
        previewLoading: true,
        exportJob: null,
        generating: false,
        downloadBusy: false,
      });
    } catch (error) {
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
        previous.phase === 'ready'
          ? { ...previous, previewLoading: true }
          : previous,
      );
      try {
        const preview = await previewReport(reportType, filters, controller.signal);
        setState((previous) =>
          previous.phase === 'ready' && previous.selectedReportType === reportType
            ? { ...previous, preview, previewLoading: false }
            : previous,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setState((previous) =>
          previous.phase === 'ready'
            ? { ...previous, previewLoading: false }
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
    setState((previous) =>
      previous.phase === 'ready'
        ? {
            ...previous,
            selectedReportType: reportType,
            preview: null,
            previewLoading: true,
            exportJob: null,
          }
        : previous,
    );
  }, []);

  const setFilters = useCallback((next: Partial<ReportFilters>) => {
    setState((previous) =>
      previous.phase === 'ready'
        ? {
            ...previous,
            filters: { ...previous.filters, ...next },
            previewLoading: true,
            exportJob: null,
          }
        : previous,
    );
  }, []);

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
      const job = await createReportExport(state.selectedReportType, state.filters);
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
                format: 'CSV',
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
      anchor.download = `${state.exportJob.reportType.toLowerCase()}.csv`;
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
    setFilters,
    generateExport,
    downloadExport,
    cancelExport,
    reload: loadCatalog,
  };
}
