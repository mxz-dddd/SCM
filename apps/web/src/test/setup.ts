import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

window.history.replaceState({}, '', '/workbench');

class RouterTestRequest {
  readonly headers: Headers;
  readonly method: string;
  readonly redirect = 'follow';
  readonly signal: AbortSignal;
  readonly url: string;

  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    this.url =
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url;
    this.method = init.method ?? 'GET';
    this.headers = new Headers(init.headers);
    this.signal = init.signal ?? new AbortController().signal;
  }
}

Object.defineProperty(globalThis, 'Request', {
  configurable: true,
  value: RouterTestRequest,
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/workbench');
});

Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })),
  writable: true,
});

const getComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element) => getComputedStyle(element);
