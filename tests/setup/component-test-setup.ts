/**
 * Setup for client-side component tests (jsdom environment).
 * Extends vitest's `expect` with @testing-library/jest-dom matchers
 * (toBeInTheDocument, toBeDisabled, toHaveAttribute, etc.) and
 * tears down rendered DOM between tests.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
