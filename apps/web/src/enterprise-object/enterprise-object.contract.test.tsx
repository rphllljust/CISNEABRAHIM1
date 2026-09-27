import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render-with-providers';
import { EnterpriseCreateSheet } from './EnterpriseCreateSheet';
import { EnterpriseObjectHeader } from './EnterpriseObjectHeader';
import { EnterpriseObjectPage } from './EnterpriseObjectPage';
import { NextActionPanel } from './NextActionPanel';
import { ObjectContextBlock } from './ObjectContextBlock';
import { ObjectStateFlow } from './ObjectStateFlow';
import { SmartRelationBar, buildAuthorizedRelations } from './SmartRelationBar';
import { isCapabilityName, toHumanText } from './human-text';

/**
 * CONTRATO DE INTERACAO ENTERPRISE — comportamento vinculante.
 *
 * Estes testes provam as regras do contrato que nao podem depender de disciplina de tela:
 * identificador tecnico nao aparece, capability nao aparece, relacao nao autorizada nao
 * aparece (nem o numero), etapa inexistente nao e inventada, acao nao permitida nao e
 * oferecida e negacao nao se confunde com vazio.
 */

const UUID = '8f14e45f-ceea-4a1b-9a1f-2b3c4d5e6f70';

describe('guarda de texto humano', () => {
  it('omite identificador tecnico e nome de capability', () => {
    expect(toHumanText(UUID)).toBeNull();
    expect(toHumanText(`Proposta ${UUID}`)).toBeNull();
    expect(toHumanText('accounting:journal:read')).toBeNull();
    expect(isCapabilityName('finance:bank-statement:read')).toBe(true);
  });

  it('preserva referencia humana de negocio', () => {
    expect(toHumanText('COM-2026-0042')).toBe('COM-2026-0042');
  });
});

describe('1 — object header', () => {
  it('mostra referencia, titulo, estado e metadados reais', () => {
    renderWithProviders(
      <EnterpriseObjectHeader
        reference="COM-2026-0042"
        title="Proposta comercial"
        subtitle="AMAGGI"
        status={{ label: 'Em negociação', tone: 'info' }}
        metadata={[
          { label: 'Valor', value: 'R$ 185.000,00', emphasis: true },
          { label: 'Válida até', value: '15/10/2026' },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Proposta comercial' })).toBeInTheDocument();
    expect(screen.getByText('COM-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('AMAGGI')).toBeInTheDocument();
    expect(screen.getByText('Em negociação')).toBeInTheDocument();
    expect(screen.getByText('R$ 185.000,00')).toBeInTheDocument();
    expect(screen.getByText('15/10/2026')).toBeInTheDocument();
  });

  it('nunca renderiza uuid nem nome de capability', () => {
    renderWithProviders(
      <EnterpriseObjectHeader
        reference={UUID}
        title="Proposta comercial"
        subtitle={UUID}
        metadata={[
          { label: 'Identificador', value: UUID },
          { label: 'Permissão', value: 'accounting:journal:read' },
        ]}
      />,
    );

    expect(screen.queryByText(UUID)).not.toBeInTheDocument();
    expect(screen.queryByText(/accounting:journal:read/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Proposta comercial' })).toBeInTheDocument();
  });

  it('omite metadado sem valor real em vez de preencher com placeholder', () => {
    renderWithProviders(
      <EnterpriseObjectHeader
        title="Ordem de serviço"
        metadata={[
          { label: 'Responsável', value: null },
          { label: 'Agenda', value: '' },
          { label: 'Cliente', value: 'AMAGGI' },
        ]}
      />,
    );

    expect(screen.queryByText('Responsável')).not.toBeInTheDocument();
    expect(screen.queryByText('Agenda')).not.toBeInTheDocument();
    expect(screen.getByText('Cliente')).toBeInTheDocument();
  });

  it('oferece apenas as acoes realmente recebidas (visibilidade por permissao)', () => {
    renderWithProviders(
      <EnterpriseObjectHeader
        title="Proposta comercial"
        primaryAction={{ id: 'issue', label: 'Emitir', onSelect: vi.fn() }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Emitir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument();
  });

  it('separa acoes destrutivas no menu de acoes secundarias', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(
      <EnterpriseObjectHeader
        title="Proposta comercial"
        primaryAction={{ id: 'accept', label: 'Aceitar', onSelect: vi.fn() }}
        secondaryActions={[{ id: 'revise', label: 'Nova revisão', onSelect: vi.fn() }]}
        destructiveActions={[{ id: 'cancel', label: 'Cancelar proposta', onSelect: onCancel }]}
      />,
    );

    // Destrutiva nao fica exposta ao lado da acao primaria.
    expect(screen.queryByRole('button', { name: 'Cancelar proposta' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Cancelar proposta' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Nova revisão' })).toBeInTheDocument();
  });
});

describe('2 — estado / fluxo', () => {
  const steps = [
    { id: 'DRAFT', label: 'Rascunho' },
    { id: 'ISSUED', label: 'Emitida' },
    { id: 'ACCEPTED', label: 'Aceita' },
  ];

  it('representa o fluxo com o estado atual marcado', () => {
    renderWithProviders(<ObjectStateFlow steps={steps} currentId="ISSUED" />);

    expect(screen.getByText('Rascunho')).toBeInTheDocument();
    expect(screen.getByText('Emitida')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Aceita')).not.toHaveAttribute('aria-current');
  });

  it('nao inventa etapa: sem estado atual real nenhum passo e marcado', () => {
    renderWithProviders(<ObjectStateFlow steps={steps} currentId={null} />);

    expect(screen.queryByText('Emitida')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Rascunho')).not.toHaveAttribute('aria-current');
  });

  it('nao renderiza fluxo quando nao existe progressao real', () => {
    const { container } = renderWithProviders(
      <ObjectStateFlow steps={[{ id: 'DRAFT', label: 'Rascunho' }]} currentId="DRAFT" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('5 — smart relations e autorizacao', () => {
  it('omite relacao nao autorizada por inteiro, sem count e sem rotulo de oculto', () => {
    const relations = buildAuthorizedRelations([
      { id: 'requests', label: 'Solicitações', count: 4, to: '/app/requests?clientId=c1', allowed: true },
      { id: 'receivables', label: 'Recebíveis', count: 3, to: '/app/finance/receivables?clientId=c1', allowed: false },
    ]);

    renderWithProviders(<SmartRelationBar relations={relations} />);

    expect(screen.getByText('Solicitações')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('Recebíveis')).not.toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(screen.queryByText(/oculto/i)).not.toBeInTheDocument();
  });

  it('nao renderiza numero orfao: relacao sem destino real e descartada', () => {
    const relations = buildAuthorizedRelations([
      { id: 'orphan', label: 'Documentos', count: 8, to: '   ', allowed: true },
      { id: 'orders', label: 'Pedidos', count: 2, to: '/app/purchase-orders?clientId=c1', allowed: true },
    ]);

    renderWithProviders(<SmartRelationBar relations={relations} />);

    expect(screen.queryByText('Documentos')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pedidos/ })).toHaveAttribute(
      'href',
      '/app/purchase-orders?clientId=c1',
    );
  });

  it('nao renderiza a secao quando nenhuma relacao e autorizada', () => {
    const relations = buildAuthorizedRelations([
      { id: 'receivables', label: 'Recebíveis', count: 3, to: '/app/finance/receivables', allowed: false },
    ]);

    const { container } = renderWithProviders(<SmartRelationBar relations={relations} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('4 e 7 — contexto e proxima acao', () => {
  it('omite campo de contexto sem dado real', () => {
    renderWithProviders(
      <ObjectContextBlock
        fields={[
          { label: 'Cliente', value: 'AMAGGI', to: '/app/clients/c1' },
          { label: 'Unidade', value: null },
          { label: 'Origem', value: '' },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'AMAGGI' })).toHaveAttribute('href', '/app/clients/c1');
    expect(screen.queryByText('Unidade')).not.toBeInTheDocument();
    expect(screen.queryByText('Origem')).not.toBeInTheDocument();
  });

  it('nao inventa proxima acao quando ela nao existe', () => {
    const { container } = renderWithProviders(<NextActionPanel action={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('representa espera de terceiro sem oferecer botao', () => {
    renderWithProviders(
      <NextActionPanel
        action={{ kind: 'waiting', label: 'Aguardar aceite do cliente', waitingOn: 'AMAGGI' }}
      />,
    );

    expect(screen.getByText('Aguardar aceite do cliente')).toBeInTheDocument();
    expect(screen.getByText('Responsável: AMAGGI')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('leva a proxima acao a um destino real', () => {
    renderWithProviders(
      <NextActionPanel action={{ kind: 'act', label: 'Emitir proposta', to: '/app/proposals/p1' }} />,
    );

    expect(screen.getByRole('link', { name: 'Emitir proposta' })).toHaveAttribute(
      'href',
      '/app/proposals/p1',
    );
  });
});

describe('8 — estados de pagina e create sheet', () => {
  it('negacao nao se confunde com vazio', () => {
    renderWithProviders(
      <EnterpriseObjectPage phase="denied" phaseTitle="Proposta" header={null} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/permissão/i);
    expect(screen.queryByText(/não está mais disponível/i)).not.toBeInTheDocument();
  });

  it('erro oferece nova tentativa real e nao mascara falha', () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <EnterpriseObjectPage
        phase="error"
        phaseTitle="Ordem de serviço"
        onRetry={onRetry}
        header={null}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('create sheet organiza a criacao em secoes empresariais e expoe erro real', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    renderWithProviders(
      <EnterpriseCreateSheet
        open
        title="Nova proposta"
        sections={[
          { id: 'identification', title: 'Identificação', content: <input aria-label="Título" /> },
          { id: 'commercial', title: 'Condições comerciais', content: <input aria-label="Valor" /> },
        ]}
        submitLabel="Criar proposta"
        onSubmit={onSubmit}
        onClose={onClose}
        error="O cliente informado não está ativo."
      />,
    );

    expect(screen.getByText('Identificação')).toBeInTheDocument();
    expect(screen.getByText('Condições comerciais')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('O cliente informado não está ativo.');

    await user.click(screen.getByRole('button', { name: 'Criar proposta' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('nao submete enquanto a criacao esta em andamento', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithProviders(
      <EnterpriseCreateSheet
        open
        title="Nova proposta"
        sections={[{ id: 'identification', title: 'Identificação', content: <input aria-label="Título" /> }]}
        submitLabel="Criar proposta"
        onSubmit={onSubmit}
        onClose={vi.fn()}
        submitting
      />,
    );

    // Durante a submissao o botao anuncia progresso e fica indisponivel.
    const submit = screen.getByRole('button', { name: /Carregando: Salvando/ });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('continuidade de navegacao', () => {
  it('preserva o caminho percorrido no breadcrumb', () => {
    renderWithProviders(
      <EnterpriseObjectPage
        breadcrumb={[
          { label: 'Clientes', href: '/app/clients' },
          { label: 'AMAGGI', href: '/app/clients/c1' },
          { label: 'COM-2026-0042' },
        ]}
        header={<h1>Proposta comercial</h1>}
      />,
    );

    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/app/clients');
    expect(screen.getByRole('link', { name: 'AMAGGI' })).toHaveAttribute('href', '/app/clients/c1');
    expect(screen.getByText('COM-2026-0042')).toHaveAttribute('aria-current', 'page');
  });
});
