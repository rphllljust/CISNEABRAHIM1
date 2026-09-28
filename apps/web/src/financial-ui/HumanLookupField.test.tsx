import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render-with-providers';
import { HumanLookupField, type HumanLookupOption } from './HumanLookupField';

const OPTIONS: HumanLookupOption[] = [
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', label: 'Alfa Insumos', support: '11.222.333/0001-81' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', label: 'Beta Pecas', support: '33.444.555/0001-03' },
];

function Harness({ search }: { search: (term: string) => Promise<HumanLookupOption[]> }) {
  const [value, setValue] = useState('');
  return (
    <>
      <HumanLookupField
        label="Fornecedor"
        htmlFor="supplier-search"
        search={search}
        value={value}
        onChange={setValue}
      />
      <p data-testid="selected">{value}</p>
    </>
  );
}

describe('HumanLookupField', () => {
  it('loads options from the server and keeps the identifier internal', async () => {
    const search = vi.fn(async () => OPTIONS);
    const user = userEvent.setup();
    renderWithProviders(<Harness search={search} />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Alfa Insumos — 11.222.333/0001-81' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Fornecedor'), OPTIONS[1]!.id);

    // O identificador é o valor do campo, nunca o texto que o operador digita.
    expect(screen.getByTestId('selected')).toHaveTextContent(OPTIONS[1]!.id);
    expect(screen.getByLabelText('Fornecedor')).toHaveValue(OPTIONS[1]!.id);
  });

  it('sends the free-text term to the server instead of filtering locally', async () => {
    const search = vi.fn(async () => OPTIONS);
    const user = userEvent.setup();
    renderWithProviders(<Harness search={search} />);

    await waitFor(() => {
      expect(search).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText('Buscar fornecedor'), 'Beta');

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('Beta', expect.anything());
    });
  });

  it('declares an empty result instead of offering an identifier field', async () => {
    const search = vi.fn(async () => []);
    renderWithProviders(<Harness search={search} />);

    await waitFor(() => {
      expect(screen.getByText('Nenhum registro encontrado para a busca.')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/identificador/i)).not.toBeInTheDocument();
  });

  it('surfaces a server search failure as an error, not as an empty list', async () => {
    const search = vi.fn(async () => {
      throw new Error('offline');
    });
    renderWithProviders(<Harness search={search} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível buscar/i);
    });
  });
});
