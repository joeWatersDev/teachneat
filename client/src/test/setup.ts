import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no ResizeObserver; components that observe element size (e.g. the
// attendance heatmap's width-fit) need a no-op stub to mount under test.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
  // Reset DOM state between tests.
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});
