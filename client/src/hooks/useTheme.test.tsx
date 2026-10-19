import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './useTheme';

function Probe() {
  const { mode, toggle } = useTheme();
  return (
    <>
      <span data-testid="mode">{mode}</span>
      <button type="button" onClick={toggle}>
        toggle
      </button>
    </>
  );
}

describe('ThemeProvider', () => {
  it('defaults to light mode when no preference is stored', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('respects a stored dark preference', () => {
    window.localStorage.setItem('ttk.theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('toggles and persists to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('ttk.theme')).toBe('dark');
  });

  it('keeps the data-theme attribute in sync', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('throws if useTheme is called outside a provider', () => {
    expect(() =>
      render(
        <Probe />,
      ),
    ).toThrow(/ThemeProvider/);
  });
});

// Silence the act() warning for the throw test by isolating the failure.
// (vitest+jsdom doesn't need real timers here.)
void act;
