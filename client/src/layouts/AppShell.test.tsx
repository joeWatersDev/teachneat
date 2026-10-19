import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';

// The shell renders the top bar, which reads the account; nothing here depends
// on a real profile, so the hooks are stubbed to their empty state.
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ profile: null, signOut: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ mode: 'light', toggle: vi.fn() }) }));
vi.mock('../hooks/useEntitlements', () => ({
  useEntitlements: () => ({ plan: 'free', isPremium: false, highAbsenceRate: 0.15 }),
}));
// The upgrade provider sits above AppShell in App.tsx, not inside it.
vi.mock('../hooks/useUpgrade', () => ({
  useUpgrade: () => ({ openUpgrade: vi.fn(), promptFromGatedControls: true }),
}));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  // Step 3a. Absolutely positioned decoration near the right edge (a tooltip
  // bubble, a popover) contributes to the document's scrollable width even while
  // invisible, and a document wider than the viewport displaces the fixed top bar
  // and pushes the fixed sidebar's footer out of reach. Clipping at the layout
  // boundary means no future decoration can widen the document again.
  //
  // Asserted as a class rather than by measuring: jsdom has no layout engine, so
  // `scrollWidth` is always 0 and the overflow is only observable in a browser.
  it('clips horizontal overflow at the content boundary', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toHaveClass('overflow-x-clip');
    // `hidden` would make this a scroll container and break `position: sticky`
    // in the History grid and the Statistics table.
    expect(main).not.toHaveClass('overflow-x-hidden');
  });
});
