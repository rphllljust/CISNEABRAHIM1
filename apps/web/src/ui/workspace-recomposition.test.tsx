import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynamicContextDrawer } from '../engine/DynamicContextDrawer';
import { EnterpriseObjectPage, ObjectPanel } from '../enterprise-object/EnterpriseObjectPage';
import { ModulePage } from './module-layout';
import { WorkspaceBody } from './workspace-frame';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function viewport(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  }));
}

function Worklist() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <MemoryRouter>
      <ModulePage layout="workspace">
        <input aria-label="Filtro da fila" defaultValue="em aberto" />
        <button onClick={() => setSelected('Cliente A')}>Selecionar A</button>
        <button onClick={() => setSelected('Cliente B')}>Selecionar B</button>
        <DynamicContextDrawer
          open={selected !== null}
          title="Contexto do cliente"
          onClose={() => setSelected(null)}
          crossReferences={[{ label: 'Contrato publicado', href: '/app/contracts/contract-a' }]}
        >
          <p>{selected}</p>
        </DynamicContextDrawer>
      </ModulePage>
    </MemoryRouter>
  );
}

describe('drawer dinâmico — sem coluna fixa e sem perder a fila', () => {
  it('abre por seleção, troca o registro e devolve toda a largura ao fechar', async () => {
    viewport(true);
    const user = userEvent.setup();
    const { container } = render(<Worklist />);
    const workbench = container.querySelector('[data-layout="context-workbench"]');
    expect(workbench).toHaveAttribute('data-context-open', 'false');
    expect(screen.queryByRole('region', { name: 'Contexto do cliente' })).not.toBeInTheDocument();
    const filter = screen.getByRole('textbox', { name: 'Filtro da fila' });
    await user.clear(filter);
    await user.type(filter, 'Cliente');
    await user.click(screen.getByRole('button', { name: 'Selecionar A' }));
    expect(workbench).toHaveAttribute('data-context-open', 'true');
    const panel = screen.getByRole('region', { name: 'Contexto do cliente' });
    expect(within(panel).getByText('Cliente A')).toBeInTheDocument();
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(panel).not.toHaveClass('fixed');
    expect(filter).toHaveValue('Cliente');
    expect(within(panel).getByRole('link', { name: 'Abrir' })).toHaveAttribute(
      'href',
      '/app/contracts/contract-a',
    );
    await user.click(screen.getByRole('button', { name: 'Selecionar B' }));
    expect(within(panel).getByText('Cliente B')).toBeInTheDocument();
    expect(within(panel).queryByText('Cliente A')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(workbench).toHaveAttribute('data-context-open', 'false');
    expect(screen.queryByTestId('dynamic-context-drawer')).not.toBeInTheDocument();
    expect(filter).toHaveValue('Cliente');
  });

  it('mantém o enquadramento sobreposto apenas no viewport estreito', async () => {
    viewport(false);
    const user = userEvent.setup();
    const { container } = render(<Worklist />);
    await user.click(screen.getByRole('button', { name: 'Selecionar A' }));
    expect(screen.getByRole('dialog', { name: 'Contexto do cliente' })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="context-workbench"]')).toHaveAttribute(
      'data-context-open',
      'false',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('contexto de processo é disclosure voluntário, não coluna permanente', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceBody context={<p>Origem autorizada do recorte</p>}>
        <p>Fila operacional</p>
      </WorkspaceBody>,
    );
    expect(screen.queryByText('Origem autorizada do recorte')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Contexto do processo' }));
    expect(screen.getByText('Origem autorizada do recorte')).toBeInTheDocument();
    expect(screen.getByText('Fila operacional')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar contexto do processo' }));
    expect(screen.queryByText('Origem autorizada do recorte')).not.toBeInTheDocument();
  });
});

describe('object page — conteúdo separado da decisão', () => {
  it('mantém conteúdo, ações e vínculos reais em regiões distintas com navegação de seção', () => {
    render(
      <MemoryRouter>
        <EnterpriseObjectPage
          header={<h1>Contrato 42</h1>}
          nextAction={<button>Renovar contrato</button>}
          context={<p>Cliente autorizado</p>}
        >
          <ObjectPanel title="Escopo">
            <p>Escopo persistido</p>
          </ObjectPanel>
          <ObjectPanel title="Documentos">
            <p>Documento publicado</p>
          </ObjectPanel>
        </EnterpriseObjectPage>
      </MemoryRouter>,
    );
    const decision = screen.getByRole('complementary', { name: 'Decisões e contexto do registro' });
    expect(within(decision).getByRole('button', { name: 'Renovar contrato' })).toBeInTheDocument();
    expect(within(decision).getByText('Cliente autorizado')).toBeInTheDocument();
    expect(within(decision).queryByText('Escopo persistido')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Seções do registro' })).getByRole('link', {
        name: 'Documentos',
      }),
    ).toHaveAttribute('href', '#object-documentos');
    expect(screen.getByRole('region', { name: 'Documentos' })).toHaveAttribute(
      'id',
      'object-documentos',
    );
    expect(screen.queryByText(/SLA|saldo|risco/i)).not.toBeInTheDocument();
  });
});
