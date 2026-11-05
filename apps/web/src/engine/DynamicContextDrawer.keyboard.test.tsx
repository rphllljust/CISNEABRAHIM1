import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DynamicContextDrawer } from './DynamicContextDrawer';

vi.mock('../shell/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));

function WorklistWithDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir contexto</button>
      <DynamicContextDrawer
        open={open}
        title="Contexto OS"
        onClose={() => setOpen(false)}
        crossReferences={[{ label: 'OS', detail: 'OS-001' }]}
      >
        <button type="button">Primeira ação</button>
        <button type="button">Última ação</button>
      </DynamicContextDrawer>
    </>
  );
}

describe('ERP context drawer keyboard contract', () => {
  it('keeps focus inside the modal and restores the worklist trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<WorklistWithDrawer />);
    const trigger = screen.getByRole('button', { name: 'Abrir contexto' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Contexto OS' });
    expect(dialog).toHaveFocus();
    const close = screen.getByTestId('dynamic-context-drawer-close');
    const final = screen.getByRole('button', { name: 'Última ação' });
    final.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(final).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Contexto OS' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
