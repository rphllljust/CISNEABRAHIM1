import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusAxes } from './operations-object-panels';

describe('OS 360 economic status axes', () => {
  it('renders unavailable owner facts without declaring ineligibility', () => {
    render(<StatusAxes statuses={{ operational: 'COMPLETED', billing: 'UNKNOWN', accounting: 'UNKNOWN' }} />);
    const billing = screen.getByText('Faturamento').closest('div')!;
    const accounting = screen.getByText('Contabilidade').closest('div')!;
    expect(within(billing).getByText('Indisponível')).toBeInTheDocument();
    expect(within(accounting).getByText('Indisponível')).toBeInTheDocument();
    expect(screen.queryByText('NOT_ELIGIBLE')).not.toBeInTheDocument();
    expect(screen.queryByText('NOT_APPLICABLE')).not.toBeInTheDocument();
  });

  it('renders authorized states and a non-invented mixed-state indicator', () => {
    render(<StatusAxes statuses={{ billing: 'FINALIZED', accounting: 'MIXED' }} />);
    expect(screen.getByText('FINALIZED')).toBeInTheDocument();
    expect(screen.getByText('Estados distintos')).toBeInTheDocument();
  });
});
