import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhoneCameraMenu } from './PhoneCameraMenu';
import { CAMERA_PRESET_NAMES } from '@/components/canvas/three/cameraPresets';

afterEach(cleanup);

describe('PhoneCameraMenu', () => {
  it('offers the camera presets and no quality choice: the twin always draws at High (Chase, 2026-10-12)', () => {
    render(<PhoneCameraMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    const choices = screen.getAllByRole('button').map((b) => b.textContent?.trim()).slice(1); // after the menu button
    expect(choices).toEqual(CAMERA_PRESET_NAMES);
    expect(screen.queryByText(/quality/i)).toBeNull();
    for (const mode of ['Auto', 'High', 'Med', 'Medium', 'Low']) {
      expect(screen.queryByRole('button', { name: mode })).toBeNull();
    }
  });
});
