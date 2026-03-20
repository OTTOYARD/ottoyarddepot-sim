import { TopBar } from '@/components/layout/TopBar';
import { SidePanel } from '@/components/layout/SidePanel';
import { DepotCanvas } from '@/components/canvas/DepotCanvas';

const App = () => (
  <div className="h-screen w-screen flex flex-col overflow-hidden bg-otto-dark">
    <TopBar />
    <div className="flex-1 flex min-h-0">
      <DepotCanvas />
      <SidePanel />
    </div>
  </div>
);

export default App;
