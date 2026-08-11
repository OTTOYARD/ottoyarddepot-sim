import { useMemo } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import { useSimulationStore } from '@/store/simulationStore';
import { useTwinStore } from '@/store/twinStore';
import { Badge } from '@/components/ui/badge';
import {
  readWorkflowFromSnapshot,
  isCriticalUrgency,
  urgencyLabel,
  type VisitWorkflow,
  type WorkflowItem,
} from '@/lib/visitWorkflow';

const TYPE_COLORS: Record<string, string> = {
  fleet: '#00B4A6',
  core: '#FFFFFF',
  concierge: '#C0C0C0',
  elite: '#FFD700',
};

// OEM platform palette — matches VehicleDot.tsx / Vehicle3D.tsx / DepotLegend.tsx
const OEM_COLORS: Record<string, string> = {
  waymo: '#5B9BFF', tesla: '#FF453A', zoox: '#B06BFF',
};
const OEM_LABELS: Record<string, string> = {
  waymo: 'Waymo', tesla: 'Tesla', zoox: 'Zoox',
};

const TEAL = '#00B4A6';
const CRITICAL = '#C00000';
const MUTED = '#666666';
const DIM = '#999999';

interface Props {
  svgRef: React.RefObject<SVGSVGElement>;
}

/** One checklist row. Every visual state maps 1:1 to a published atom status. */
const WorkflowRow = ({ item, isActive }: { item: WorkflowItem; isActive: boolean }) => {
  const done = item.state === 'done';
  const active = item.state === 'active';
  const dropped = item.state === 'dropped';

  const boxStyle = done
    ? { backgroundColor: TEAL, borderColor: TEAL, color: '#06070A' }
    : active
      ? { backgroundColor: 'transparent', borderColor: TEAL, color: TEAL }
      : dropped
        ? { backgroundColor: 'transparent', borderColor: '#555', color: MUTED }
        : { backgroundColor: 'transparent', borderColor: isActive ? '#4A6E6B' : '#4A4A4A', color: 'transparent' };

  const labelColor = done ? TEAL : active ? '#FFFFFF' : dropped ? MUTED : isActive ? '#D8D8D8' : DIM;

  return (
    <div
      className="flex items-center gap-1.5 leading-tight"
      data-testid="workflow-row"
      data-svc={item.svc}
      data-state={item.state}
      data-active={isActive ? 'true' : 'false'}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-[3px] border text-[8px] font-bold shrink-0"
        style={{ width: 11, height: 11, ...boxStyle }}
      >
        {done ? '✓' : dropped ? '–' : ''}
      </span>
      <span
        className="text-[10px] truncate"
        style={{ color: labelColor, textDecoration: dropped ? 'line-through' : undefined }}
      >
        {item.label}
      </span>
      {active && (
        <span className="text-[9px] uppercase tracking-wide shrink-0" style={{ color: TEAL }}>
          in progress
        </span>
      )}
      {!active && isActive && (
        <span className="text-[9px] uppercase tracking-wide shrink-0" style={{ color: '#4A6E6B' }}>
          in progress
        </span>
      )}
      <span className="flex-1" />
      {item.estMin !== null && (
        <span className="text-[9px] font-mono shrink-0" style={{ color: MUTED }}>
          {item.estMin}m
        </span>
      )}
    </div>
  );
};

/**
 * The OTTO-Q workflow block: what this car came in for, and where it is in the
 * plan. Renders ONLY what the snapshot published — the three non-visit states
 * are three different sentences, never a blank checklist implying "nothing
 * needed".
 */
const WorkflowBlock = ({ workflow }: { workflow: VisitWorkflow }) => {
  if (workflow.kind === 'unpublished') {
    return (
      <div className="text-[10px] mt-1.5 pt-1.5 border-t" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }} data-testid="workflow-unpublished">
        No workflow published
      </div>
    );
  }
  if (workflow.kind === 'no_visit') {
    return (
      <div className="text-[10px] mt-1.5 pt-1.5 border-t" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }} data-testid="workflow-no-visit">
        No open depot visit
      </div>
    );
  }

  const { items, clearedCount, totalCount, activeIndex, allComplete, card } = workflow;

  return (
    <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }} data-testid="workflow-visit">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase tracking-wide" style={{ color: MUTED }}>
          OTTO-Q workflow
        </span>
        {card.urgency && (
          <span
            className="text-[9px] uppercase tracking-wide"
            style={{ color: isCriticalUrgency(card.urgency) ? CRITICAL : DIM }}
            data-testid="workflow-urgency"
          >
            {urgencyLabel(card.urgency)}
          </span>
        )}
      </div>

      {totalCount === 0 ? (
        // A real, distinct state: OTTO-Q opened the visit and put no work on it.
        <div className="text-[10px]" style={{ color: MUTED }} data-testid="workflow-empty">
          Visit open · no services assigned
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((item, i) => (
            <WorkflowRow key={`${item.svc}-${i}`} item={item} isActive={i === activeIndex} />
          ))}
        </div>
      )}

      {allComplete ? (
        <div
          className="mt-1.5 rounded-sm px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-center"
          style={{ backgroundColor: 'rgba(0,180,166,0.16)', color: TEAL }}
          data-testid="workflow-ready"
        >
          All services complete · ready for dispatch
        </div>
      ) : totalCount > 0 ? (
        <div className="text-[9px] mt-1" style={{ color: MUTED }} data-testid="workflow-progress">
          {clearedCount} of {totalCount} cleared
        </div>
      ) : null}
    </div>
  );
};

export const VehicleTooltip = ({ svgRef }: Props) => {
  const hoveredVehicleId = useVehicleStore((s) => s.hoveredVehicleId);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const simTime = useSimulationStore((s) => s.simTime);
  // Select the STORED snapshot object, not a value computed from it. A selector
  // that built the workflow inline would return a fresh object on every call and
  // useSyncExternalStore would loop on it; classification belongs in the memo.
  const twinSnapshot = useTwinStore((s) => s.snapshot);
  const workflow = useMemo(
    () => readWorkflowFromSnapshot(twinSnapshot, hoveredVehicleId),
    [twinSnapshot, hoveredVehicleId],
  );

  if (!hoveredVehicleId || !svgRef.current) return null;

  const v = vehicles.find((veh) => veh.id === hoveredVehicleId);
  if (!v) return null;

  const svg = svgRef.current;
  const pt = svg.createSVGPoint();
  pt.x = v.position.x;
  pt.y = v.position.y;
  const screenPt = pt.matrixTransform(svg.getScreenCTM()!);
  const rect = svg.getBoundingClientRect();
  // The card grew a checklist, so it is anchored ABOVE the car by transform
  // rather than by a fixed pixel offset that a taller card would overflow.
  const left = screenPt.x - rect.left;
  const top = screenPt.y - rect.top - 14;

  const oem = (v.oem || '').toLowerCase();
  const oemColor = OEM_COLORS[oem] || TYPE_COLORS[v.type];
  const oemLabel = OEM_LABELS[oem] || v.type;
  const socColor = v.currentSoC < 20 ? CRITICAL : v.currentSoC < 50 ? '#F59E0B' : TEAL;
  const remaining = v.serviceStartTime !== null && v.serviceDuration !== null
    ? Math.max(0, v.serviceDuration - (simTime - v.serviceStartTime))
    : null;
  const remainingMin = remaining !== null ? (remaining / 60).toFixed(1) : null;

  // Entry SoC and charge target come from the visit OTTO-Q opened, so they are
  // absent exactly when no visit is published — never back-filled from the
  // live SoC.
  const visitCard = workflow.kind === 'visit' ? workflow.card : null;
  const socOnEntry = visitCard?.soc_at_arrival ?? null;
  const targetSoc = visitCard?.target_soc ?? null;
  const estChargeMin = visitCard?.est_charge_min ?? null;

  return (
    <div
      className="absolute z-50 pointer-events-none rounded-md px-3 py-2 shadow-lg border"
      style={{
        left,
        top,
        transform: 'translate(-50%, -100%)',
        minWidth: 190,
        maxWidth: 260,
        backgroundColor: '#2D2D2D',
        borderColor: 'rgba(255,255,255,0.15)',
      }}
      data-testid="vehicle-tooltip"
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: oemColor }}
        />
        <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>{v.label ?? v.id}</span>
        <Badge className="text-[10px] px-1.5 py-0 capitalize" style={{ backgroundColor: oemColor + '33', color: oemColor }}>
          {oemLabel}
        </Badge>
      </div>

      {/* SoC bar — live SoC, with OTTO-Q's charge target marked when published */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px]" style={{ color: MUTED }}>SoC</span>
        <div className="relative flex-1 h-1.5 rounded-full" style={{ backgroundColor: '#444' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, v.currentSoC))}%`, backgroundColor: socColor }}
          />
          {targetSoc !== null && (
            <span
              aria-hidden
              className="absolute top-[-2px] w-px"
              style={{
                height: 10,
                left: `${Math.max(0, Math.min(100, targetSoc))}%`,
                backgroundColor: '#FFFFFF',
                opacity: 0.7,
              }}
              data-testid="soc-target-mark"
            />
          )}
        </div>
        <span className="text-[10px] font-mono" style={{ color: socColor }}>{Math.round(v.currentSoC)}%</span>
      </div>

      {/* Entry -> now -> target. Each number is omitted when it was not published. */}
      <div className="flex items-center gap-2 text-[9px] font-mono mb-1" style={{ color: DIM }}>
        {socOnEntry !== null && (
          <span data-testid="soc-on-entry">in {Math.round(socOnEntry)}%</span>
        )}
        {targetSoc !== null && (
          <span data-testid="soc-target">target {Math.round(targetSoc)}%</span>
        )}
        {estChargeMin !== null && (
          <span data-testid="est-charge-min">~{estChargeMin}m charge</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] capitalize" style={{ color: DIM }}>{v.status}</span>
        {remainingMin && (
          <span className="text-[10px]" style={{ color: '#F59E0B' }}>{remainingMin}m left</span>
        )}
      </div>

      {/* The old "Services: 0/0" counter read vehicleStore.serviceQueue, which
          TwinMotionDriver always publishes EMPTY — in the one live drive mode it
          could only ever render 0/0. The checklist below is the real thing. */}
      <WorkflowBlock workflow={workflow} />
    </div>
  );
};
