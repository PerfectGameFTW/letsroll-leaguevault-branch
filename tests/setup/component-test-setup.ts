/**
 * Setup for client-side component tests (jsdom environment).
 * Extends vitest's `expect` with @testing-library/jest-dom matchers
 * (toBeInTheDocument, toBeDisabled, toHaveAttribute, etc.) and
 * tears down rendered DOM between tests.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Side-effect import: installs the in-process [ERROR] log guard
// (Task #746) for the client-components project too.
import './error-log-guard';

// jsdom doesn't implement the Pointer Capture APIs that several
// Radix primitives (Toast, Select, Popover, ...) call from their
// pointer-down handlers. Without these stubs Radix throws
// "target.hasPointerCapture is not a function" as an unhandled
// exception during user-event interactions, which fails the test
// run even when assertions pass.
if (typeof window !== 'undefined') {
  const proto = window.HTMLElement.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
    scrollIntoView?: () => void;
  };
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
