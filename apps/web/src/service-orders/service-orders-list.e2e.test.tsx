import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createServiceOrdersFetchMock } from '../test/service-orders-fetch-mock';

/**
 * Lista de OS pelo BROWSER, contra a engine.
 *
 * O contrato verificado aqui mudou junto com a tela. Antes, a lista era JSX artesanal: expunha
 * `PrimaryRecordCell` com link de identificador, um `<select>` de status e um `filter` lido da
 * query string. Depois da migração, a lista é `DynamicList`: as colunas vêm de
 * `meta.views.layout.columns` e a navegação é clique na LINHA, não link.
 *
 * A asserção foi reescrita para o contrato VIGENTE — não relaxada. O que se verifica agora é o
 * que a engine realmente entrega: a tabela declara a entidade, o cabeçalho carrega os rótulos
 * do metadado e a linha navega para a OS.
 */
describe('service orders list e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
  });

  it('renders the list through the engine, with columns labelled by the metadata', async () => {
    window.history.pushState({}, '', '/app/service-orders');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /ordens de serviço/i })).toBeInTheDocument();
    });

    const table = await screen.findByTestId('dynamic-list');
    expect(table).toHaveAttribute('data-entity', 'service-orders');

    // Os cabeçalhos são os RÓTULOS de `meta.fields`, não texto escrito no componente.
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /número da os/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('columnheader', { name: /situação/i })).toBeInTheDocument();
  }, 20000);

  it('renders the workflow state of the record using the metadata label', async () => {
    window.history.pushState({}, '', '/app/service-orders');
    render(<App />);

    /*
     * A coluna `status` é `select`: o `FieldRenderer` desenha o rótulo de
     * `meta.fields.options`, e não o valor cru do enum.
     *
     * A consulta é ESCOPADA À TABELA porque o mesmo rótulo também aparece como `<option>` do
     * `DynamicFilterBar` — os dois são legítimos e coexistem na tela. Um `getByText` global
     * encontraria os dois e falharia por ambiguidade do teste, não por defeito da tela.
     */
    const table = await screen.findByTestId('dynamic-list');
    await waitFor(() => {
      expect(within(table).getByRole('cell', { name: 'Liberada' })).toBeInTheDocument();
    });
  }, 20000);

  it('opens the order detail from a row click', async () => {
    window.history.pushState({}, '', '/app/service-orders');
    render(<App />);

    const table = await screen.findByTestId('dynamic-list');
    const row = await waitFor(() => {
      const found = table.querySelectorAll('tbody tr');
      expect(found.length).toBeGreaterThan(0);
      return found[0] as HTMLTableRowElement;
    });

    row.click();

    // O detalhe é renderizado pela engine: o formulário dinâmico aparece e a ActionBar
    // publica as transições que o metadado declara para o estado atual.
    await waitFor(() => {
      expect(screen.getByTestId('dynamic-form')).toBeInTheDocument();
    });
  }, 20000);
});
