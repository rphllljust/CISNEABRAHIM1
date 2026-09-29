import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderBillingRoutes } from '../../test/render-billing-routes';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../../test/service-orders-fetch-mock';

const documentPath = `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/billing/document`;

describe('ServiceOrderBillingDocumentPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renders workflow sections and faithful preview', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
        purchaseOrderPaymentTerms: '30 DDL',
      }),
    );
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /OS-2026-DEMO01/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('navigation', { name: /etapas do documento/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /resumo do faturamento/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /dados do cliente/i })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /pré-visualização da nota fatura/i })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /pré-visualização da nota fatura/i })).toHaveTextContent(
      'NOTA FATURA',
    );
    expect(screen.getByText(/Atribuído na emissão/i)).toBeInTheDocument();
    expect(screen.getByText(/PDF persistido é gerado exclusivamente pelo backend/i)).toBeInTheDocument();
  });

  it('shows the business chain so billing connects to what it generated', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
        purchaseOrderPaymentTerms: '30 DDL',
      }),
    );
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /OS-2026-DEMO01/i })).toBeInTheDocument();
    });

    const chain = await screen.findByRole('heading', { name: /cadeia de negócio do faturamento/i });
    const section = chain.closest('section');
    expect(section).not.toBeNull();
    // Continuidade real: o que foi executado e o que o faturamento gerou.
    expect(within(section!).getAllByText(/MED-2026-0001/).length).toBeGreaterThan(0);
    expect(within(section!).getAllByText(/AR-0001/).length).toBeGreaterThan(0);
    // Elos navegaveis por clique.
    expect(within(section!).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('blocks issuance when commercial terms mismatch is unresolved', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
        purchaseOrderPaymentTerms: '07 DDL',
        preparedPaymentTerms: 'À vista',
      }),
    );
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByRole('alert', { name: /divergência de condições comerciais/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /emitir nota fatura/i })).not.toBeInTheDocument();
    expect(screen.getByText(/emissão indisponível no estado atual/i)).toBeInTheDocument();
  });

  it('finalizes document after confirmation dialog', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
      }),
    );
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /emitir nota fatura/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /emitir nota fatura/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Atribuído na emissão/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Cliente Demo LTDA/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /emitir nota fatura/i }));

    await waitFor(() => {
      expect(screen.getByText(/NF-2026-\d{6} emitida com sucesso/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /^emitir nota fatura$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/documento ativo: NF-2026-/i)).toBeInTheDocument();
  });

  it('shows error on duplicate finalize attempt from API', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
        billingDocumentAlreadyExists: true,
      }),
    );
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /emitir nota fatura/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /emitir nota fatura/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /emitir nota fatura/i }));

    await waitFor(() => {
      expect(screen.getByText(/já existe uma nota fatura ativa/i)).toBeInTheDocument();
    });
  });

  it('downloads issued PDF from server artifact', async () => {
    const user = userEvent.setup();
    const fetchMock = createServiceOrdersFetchMock({
      orderCompleted: true,
      seedMeasurement: 'approved',
      seedBilling: 'prepared',
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /emitir nota fatura/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /emitir nota fatura/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /emitir nota fatura/i }));

    const downloadButton = await screen.findByRole('button', { name: /baixar pdf/i });
    await user.click(downloadButton);

    await waitFor(() => {
      const pdfCalls = fetchMock.mock.calls.filter((call) => {
        const request = call[0];
        const url = typeof request === 'string' ? request : request instanceof Request ? request.url : '';
        return url.includes('/pdf');
      });
      expect(pdfCalls.length).toBeGreaterThan(0);
    });
  });

  it('exposes accessible labels and responsive preview layout', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
      }),
    );
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByLabelText(/pré-visualização da nota fatura/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/data de vencimento/i)).toBeInTheDocument();
    expect(document.querySelector('.billing-doc-preview')).toBeTruthy();
    expect(document.querySelector('.billing-doc-sticky-actions')).toBeTruthy();
    expect(document.querySelector('.billing-doc-workflow-nav')).toBeTruthy();
  });

  it('denies access when document read is not allowed', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
        billingDocumentReadAllowed: false,
      }),
    );
    renderBillingRoutes(documentPath);

    await waitFor(() => {
      expect(screen.getByText(/não tem permissão para emitir documentos/i)).toBeInTheDocument();
    });
  });

  it('shows issued document id in list after finalize', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
      }),
    );
    renderBillingRoutes(documentPath);

    await user.click(await screen.findByRole('button', { name: /emitir nota fatura/i }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /emitir nota fatura/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /baixar pdf/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /documentos emitidos/i })).toBeInTheDocument();
  });
});
