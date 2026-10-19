import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HumanLookupField, type HumanLookupOption } from './HumanLookupField';

/**
 * Orientação de cadastro ausente no lookusp humano.
 *
 * A busca vazia confundia duas causas: filtro sem resultado e cadastro inexistente. Num fluxo
 * onde NADA pode ser encontrado (ex.: emitir pedido sem fornecedor cadastrado), "nenhum registro
 * encontrado" não diz ao operador que a dependência é cadastral nem para onde ir. Estes casos
 * travam o contrato: com `emptyAction` o componente orienta e encaminha; sem ela, mantém o texto
 * simples de busca, sem inventar navegação.
 */
function renderField(props: {
  emptyMessage?: string;
  emptyAction?: { label: string; to: string };
}) {
  const empty: HumanLookupOption[] = [];
  const search = vi.fn(async () => empty);
  render(
    <MemoryRouter>
      <HumanLookupField
        label="Fornecedor"
        htmlFor="supplier-search"
        required
        search={search}
        value=""
        onChange={() => undefined}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('HumanLookupField empty state', () => {
  it('shows the search-empty message without inventing a registration path', async () => {
    renderField({ emptyMessage: 'Nenhum fornecedor encontrado para a busca.' });
    const status = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(status).toHaveTextContent('Nenhum fornecedor encontrado para a busca.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('orients and links to the existing registration screen when the caller names it', async () => {
    renderField({
      emptyMessage:
        'Nenhum fornecedor cadastrado ou encontrado para esta busca. O pedido ao fornecedor exige um fornecedor ativo no cadastro.',
      emptyAction: { label: 'Cadastrar fornecedor', to: '/app/suppliers/new' },
    });
    const status = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(status).toHaveTextContent('exige um fornecedor ativo no cadastro');
    const link = await screen.findByRole('link', { name: 'Cadastrar fornecedor' });
    expect(link).toHaveAttribute('href', '/app/suppliers/new');
  });

  it('keeps the link inside the same status region so it is announced together', async () => {
    renderField({
      emptyMessage: 'Nenhum fornecedor cadastrado ou encontrado para esta busca.',
      emptyAction: { label: 'Cadastrar fornecedor', to: '/app/suppliers/new' },
    });
    const status = await screen.findByRole('status', {}, { timeout: 3000 });
    await waitFor(() => {
      expect(status.querySelector('a')).not.toBeNull();
    });
  });
});
