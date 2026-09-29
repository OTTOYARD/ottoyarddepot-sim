import { create } from 'zustand';

/**
 * The car the 3D camera is following, if any — a VIEW choice, like the camera
 * preset, so it lives beside the renderer and never in the twin's stores. Set
 * by a tap or click on a car (CameraRig), cleared by a tap on open ground, the
 * chip's ✕, or a camera preset.
 */
interface FollowState {
  followId: string | null;
  setFollow: (id: string | null) => void;
}

export const useCameraFollow = create<FollowState>((set) => ({
  followId: null,
  setFollow: (followId) => set({ followId }),
}));
