import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReturnTo2D: () => void;
}

interface State {
  failed: boolean;
}

/** Keep the rest of the cockpit usable if a graphics context fails during 3D mount. */
export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas text-ink-dim text-sm">
          <span>3D rendering is unavailable in this browser.</span>
          <button type="button" className="rounded bg-brand-red px-3 py-2 text-white" onClick={this.props.onReturnTo2D}>
            Return to 2D
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
