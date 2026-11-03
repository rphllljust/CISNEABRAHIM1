import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { WorkInboxPage, WorkItem } from '../../work-inbox/api/work-inbox-api';
import { OperationalActivitySummary } from './OperationalActivitySummary';

const WORK_ITEM: WorkItem = {
  id: 'item-1',
  domain: 'CONTABILIDADE',
  kind: 'EXCEPTION',
  businessReference: 'Pagamento 1500',
  title: 'Pagamento sem contabilização',
  contextLabel: 'Unidade operacional',
  status: 'FAILED',
  reason: 'Falha contábil',
  occurredAt: '2026-10-01T11:00:00.000Z',
  dueAt: '2026-01-01T00:00:00.000Z',
  actionLabel: 'Abrir contabilização',
  targetRoute: '/app/accounting',
  unitId: null,
};

function page(partial = false): WorkInboxPage {
  return {
    items: [WORK_ITEM],
    total: 7,
    limit: 50,
    offset: 0,
    totalPages: 1,
    byDomain: {
      FINANCEIRO: 0,
      FISCAL: 0,
      CONTABILIDADE: 7,
      OPERACOES: 0,
      COMERCIAL: 0,
      SUPRIMENTOS: 0,
    },
    unavailableDomains: partial ? ['FISCAL'] : [],
  };
}

describe('operational workspace summary', () => {
  it('keeps server totals separate from counts on the current page', async () => {
    const onExceptions = vi.fn();
    const onOverdue = vi.fn();
    render(
      <MemoryRouter>
        <OperationalActivitySummary
          page={page()}
          onExceptions={onExceptions}
          onOverdue={onOverdue}
        />
      </MemoryRouter>,
    );

    const summary = within(screen.getByRole('region', { name: /resumo da fila operacional/i }));
    expect(summary.getByRole('link', { name: /atividades na fila/i })).toHaveTextContent('7');
    expect(summary.getByRole('button', { name: /exceções nesta página/i })).toHaveTextContent('1');
    expect(summary.getByRole('button', { name: /atrasos nesta página/i })).toHaveTextContent('1');
    expect(summary.getByText('Contagem publicada pelo servidor')).toBeInTheDocument();

    await userEvent.click(summary.getByRole('button', { name: /exceções nesta página/i }));
    await userEvent.click(summary.getByRole('button', { name: /atrasos nesta página/i }));
    expect(onExceptions).toHaveBeenCalledOnce();
    expect(onOverdue).toHaveBeenCalledOnce();
  });

  it('does not claim completeness when a source is unavailable', () => {
    render(
      <MemoryRouter>
        <OperationalActivitySummary page={page(true)} onExceptions={() => {}} onOverdue={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Leitura parcial dos domínios')).toBeInTheDocument();
  });

  it('does not substitute an unpublished total with zero', () => {
    const { container } = render(
      <MemoryRouter>
        <OperationalActivitySummary page={null} onExceptions={() => {}} onOverdue={() => {}} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
