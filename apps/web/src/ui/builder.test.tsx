import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render-with-providers';
import { BuilderSection, BuilderSummary, CollectionEditor, StickyActionBar } from './builder';
import { CurrencyField, normalizeCurrencyInput } from './CurrencyField';

/**
 * SHARED BUILDER PRIMITIVES — comportamento vinculante.
 *
 * Estes primitivos existem para que configurar uma estrutura empresarial complexa pareca
 * operacao de ERP, nao formulario cru. O que os testes protegem:
 * - dinheiro tem uma unica normalizacao e nunca vira string tecnica no payload;
 * - entrada monetaria invalida NAO produz valor (e diz isso inline);
 * - repetidores tem add/remove coerentes, remocao discreta com nome acessivel e confirmacao
 *   quando a perda e destrutiva;
 * - o resumo e da propria edicao e nao inventa KPI;
 * - toda acao interativa tem nome acessivel.
 */

function CurrencyHarness({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <CurrencyField label="Preço de venda" value={value} onChange={setValue} />
      <output data-testid="payload">{value ?? 'vazio'}</output>
    </>
  );
}

describe('normalizeCurrencyInput', () => {
  it('normaliza as grafias brasileiras para decimal de payload', () => {
    expect(normalizeCurrencyInput('1.500,50')).toBe('1500.50');
    expect(normalizeCurrencyInput('R$ 1.234,56')).toBe('1234.56');
    expect(normalizeCurrencyInput('1234,5')).toBe('1234.50');
    expect(normalizeCurrencyInput('1500.50')).toBe('1500.50');
    // convencao BR: ponto com exatamente 3 digitos e milhar
    expect(normalizeCurrencyInput('1.500')).toBe('1500.00');
  });

  it('vazio vira nulo e texto nao monetario e rejeitado', () => {
    expect(normalizeCurrencyInput('')).toBeNull();
    expect(normalizeCurrencyInput('   ')).toBeNull();
    expect(normalizeCurrencyInput('abc')).toBeNull();
    expect(normalizeCurrencyInput('1.2.3,4,5')).toBeNull();
  });
});

describe('CurrencyField', () => {
  it('entrega valor normalizado ao payload, nunca a mascara digitada', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CurrencyHarness />);

    const input = screen.getByLabelText(/Preço de venda/);
    await user.type(input, '1.500,50');
    await user.tab();

    expect(screen.getByTestId('payload')).toHaveTextContent('1500.5');
  });

  it('mostra erro inline e NAO produz payload quando a entrada e invalida', async () => {
    const user = userEvent.setup();
    const onInvalid = vi.fn();
    renderWithProviders(
      <CurrencyField label="Valor" value={null} onChange={vi.fn()} onInvalid={onInvalid} />,
    );

    const input = screen.getByLabelText(/Valor/);
    await user.type(input, 'abc');
    await user.tab();

    expect(screen.getByText(/valor monetário válido/i)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onInvalid).toHaveBeenCalledWith(true);
  });

  it('aceita valor negativo real (estorno) sem perder o sinal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CurrencyHarness />);

    await user.type(screen.getByLabelText(/Preço de venda/), '-250,00');
    await user.tab();

    expect(screen.getByTestId('payload')).toHaveTextContent('-250');
  });
});

type Row = { id: string; label: string };

describe('CollectionEditor', () => {
  function Harness({ confirmRemove = false }: { confirmRemove?: boolean }) {
    const [rows, setRows] = useState<Row[]>([{ id: 'a', label: 'DAILY' }]);
    return (
      <CollectionEditor<Row>
        items={rows}
        getKey={(row) => row.id}
        itemTitle={(row) => row.label}
        itemSubtitle={(_row, index) => `modelo ${index + 1} de ${rows.length}`}
        renderItem={(row) => <span>campos de {row.label}</span>}
        onChange={vi.fn()}
        onAdd={() => setRows((current) => [...current, { id: `n${current.length}`, label: 'NOVO' }])}
        onRemove={(index) => setRows((current) => current.filter((_, i) => i !== index))}
        addLabel="+ Adicionar modelo de preço"
        removeLabel="Remover"
        removeAriaLabel={(row) => `Remover ${row.label}`}
        emptyMessage="Nenhum modelo de preço neste serviço."
        confirmRemove={confirmRemove}
      />
    );
  }

  it('adiciona e remove itens com nomes acessiveis explicitos', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole('button', { name: /Adicionar modelo de preço/ }));
    expect(screen.getByText('NOVO')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover DAILY' }));
    expect(screen.queryByText('DAILY')).not.toBeInTheDocument();
  });

  it('pede confirmacao antes de remover quando a perda e destrutiva', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness confirmRemove />);

    await user.click(screen.getByRole('button', { name: 'Remover DAILY' }));
    // Ainda existe: a remocao so acontece depois da confirmacao explicita.
    expect(screen.getByText('DAILY')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    expect(screen.queryByText('DAILY')).not.toBeInTheDocument();
  });

  it('explica o vazio em vez de deixar um bloco sem contexto', () => {
    renderWithProviders(
      <CollectionEditor<Row>
        items={[]}
        getKey={(row) => row.id}
        itemTitle={(row) => row.label}
        renderItem={() => null}
        onChange={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        addLabel="+ Adicionar requisito"
        removeLabel="Remover"
        emptyMessage="Nenhum requisito físico exigido por este serviço."
      />,
    );

    expect(screen.getByText('Nenhum requisito físico exigido por este serviço.')).toBeInTheDocument();
  });
});

describe('BuilderSection, BuilderSummary e StickyActionBar', () => {
  it('a acao pertence a secao e nao fica solta no card', () => {
    renderWithProviders(
      <BuilderSection
        title="Modelos de preço"
        description="Defina como este serviço será cobrado."
        action={<button type="button">+ Adicionar modelo</button>}
      >
        <p>conteúdo</p>
      </BuilderSection>,
    );

    const section = screen.getByRole('region', { name: 'Modelos de preço' });
    expect(within(section).getByText('Defina como este serviço será cobrado.')).toBeInTheDocument();
  });

  it('o resumo mostra a propria edicao e omite o que nao existe', () => {
    renderWithProviders(
      <BuilderSummary
        items={[
          { label: 'Modelos de preço', value: 1 },
          { label: 'Recursos físicos', value: 0 },
          { label: 'Mão de obra', value: null },
        ]}
      />,
    );

    expect(screen.getByText('Modelos de preço')).toBeInTheDocument();
    expect(screen.getByText('Recursos físicos')).toBeInTheDocument();
    expect(screen.queryByText('Mão de obra')).not.toBeInTheDocument();
  });

  it('a barra de acao mantem as acoes reais visiveis', () => {
    renderWithProviders(
      <StickyActionBar note="Criação e publicação são decididas pelo servidor.">
        <button type="button">Cancelar</button>
        <button type="button">Criar rascunho</button>
      </StickyActionBar>,
    );

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar rascunho' })).toBeInTheDocument();
    expect(screen.getByText(/decididas pelo servidor/)).toBeInTheDocument();
  });
});
