import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** Open the page context, excluding controls owned by nested queue workspaces. */
export async function openPrimaryProcessContext(user: UserEvent): Promise<void> {
  const main = await screen.findByRole('main');
  const areas = await within(main).findAllByRole('region', {
    name: /^área de trabalho e contexto$/i,
  });
  const roots = areas.filter(
    (area) => !areas.some((other) => other !== area && other.contains(area)),
  );
  expect(roots, 'one primary workspace must own the page context').toHaveLength(1);
  const primary = roots[0]!;
  const toggles = within(primary)
    .getAllByRole('button', { name: /^contexto do processo$/i })
    .filter((button) => !areas.some((area) => area !== primary && area.contains(button)));
  expect(toggles, 'one context toggle must belong to the primary workspace').toHaveLength(1);
  const toggle = toggles[0]!;
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
