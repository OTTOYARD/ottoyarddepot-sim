import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SceneErrorBoundary } from './SceneErrorBoundary';

function UnavailableGraphics(): ReactNode {
  throw new Error('Error creating WebGL context');
}

describe('SceneErrorBoundary', () => {
  it('keeps an actionable fallback on screen when the 3D renderer throws', () => {
    const returnTo2D = vi.fn();
    const previousError = console.error;
    console.error = vi.fn();
    try {
      render(
        <SceneErrorBoundary onReturnTo2D={returnTo2D}>
          <UnavailableGraphics />
        </SceneErrorBoundary>,
      );
      expect(screen.getByRole('alert').textContent).toContain('3D rendering is unavailable');
      fireEvent.click(screen.getByRole('button', { name: 'Return to 2D' }));
      expect(returnTo2D).toHaveBeenCalledOnce();
    } finally {
      console.error = previousError;
    }
  });
});
