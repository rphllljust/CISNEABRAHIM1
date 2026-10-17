import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar } from './ActionBar';
import type { MetaEntitySchema, MetaTransition } from './types';

function transition(
  command: string,
  label: string,
  buttonOrder: number,
): MetaTransition {
  return {
    command,
    label,
    fromStates: ['DRAFT'],
    toState: command === 'prepare' ? 'PREPARED' : 'CANCELLED',
    permission: `service-orders:service-order:${command}`,
    requiresReason: command === 'cancel',
    buttonOrder,
    allowed: true,
  };
}

function schema(): MetaEntitySchema {
  return {
    name: 'service-orders',
    label: 'Ordens de serviço',
    description: null,
    dataSchema: 'so',
    dataTable: 'service_orders',
    labelField: 'order_number',
    fields: [],
    views: [],
    workflow: {
      stateField: 'status',
      states: ['DRAFT', 'PREPARED', 'CANCELLED'],
      transitions: [
        transition('prepare', 'Preparar', 10),
        transition('cancel', 'Cancelar', 20),
      ],
    },
    permissions: [],
    allowedPermLevels: [],
  };
}

describe('ActionBar — capability publicada pelo backend', () => {
  it('renderiza somente commands presentes em availableCommands', () => {
    render(
      <ActionBar
        schema={schema()}
        currentState="DRAFT"
        availableCommands={['cancel']}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Preparar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });

  it('executa somente o command publicado e não conhece precondições de domínio', () => {
    const onCommand = vi.fn();

    render(
      <ActionBar
        schema={schema()}
        currentState="DRAFT"
        availableCommands={['prepare']}
        onCommand={onCommand}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preparar' }));

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith(
      'prepare',
      expect.objectContaining({ command: 'prepare' }),
    );
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });
});
