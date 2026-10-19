import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HumanLookupField, type HumanLookupOption } from './HumanLookupField';

/**
 * Orientação de cadastro ausente no lookup humano.
 *
 * A busca vazia confundia duas causas: filtro sem resultado e cadastro inexistente. Num fluxo
 * onde NADA pode ser encontrado (ex.: emitir pedido sem fornecedor cadastrado), "nenhum registro
 * encontrado" não diz ao operador que a dependência é cadastral nem para onde ir. Estes casos
 * travam o contrato: com `emptyAction` o componente orienta e encaminha para o cadastro de
 * origem; sem ela, mantém o texto simples de busca, sem inventar navegação.
 */
function renderField(props: {
  emptyMessage?: string;
  emptyAction?: { label: string; to: string };
}) {
  const search = vi.fn(async (): Promise<HumanLookupOption[]> => []);
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
    renderField({});
    const status = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(status).toHaveTextContent('Nenhum registro encontrado para a busca.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('orients toward registration and links to the existing screen when the caller names it', async () => {
    renderField({ emptyAction: { label: 'Cadastrar', to: '/app/suppliers/new' } });
    const status = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(status).toHaveTextContent('Nada cadastrado para escolher.');
    const link = await screen.findByRole('link', { name: 'Cadastrar' });
    expect(link).toHaveAttribute('href', '/app/suppliers/new');
  });

  it('keeps an explicit emptyMessage when the caller supplies one', async () => {
    renderField({
      emptyMessage: 'Nenhum fornecedor cadastrado ou encontrado.',
      emptyAction: { label: 'Cadastrar', to: '/app/suppliers/new' },
    });
    const status = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(status).toHaveTextContent('Nenhum fornecedor cadastrado ou encontrado.');
  });

  it('announces the orientation and the link in the same status region', async () => {
    renderField({ emptyAction: { label: 'Cadastrar', to: '/app/suppliers/new' } });
    const status = await screen.findByRole('status', {}, { timeout: 3000 });
    await waitFor(() => {
      expect(status.querySelector('a')).not.toBeNull();
    });
  });
});
