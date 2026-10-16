/**
 * Global test setup: DOM matchers, and unmounting rendered trees between tests
 * so DOM state never leaks.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Drag-and-drop measures rows through ResizeObserver. jsdom does not provide
// it, but sidebar unit tests only need the observer lifecycle, not geometry.
class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver;

afterEach(cleanup);
