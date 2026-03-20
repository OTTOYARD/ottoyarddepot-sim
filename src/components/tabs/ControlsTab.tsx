import { useCallback } from 'react';
import { simulationEngine } from '@/engine/SimulationEngine';
import {
  Truck, Users, Zap, Clock, Cloud, Play, Pause, RotateCcw, AlertTriangle,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSimulationStore, type SimulationConfig } from '@/store/simulationStore';
import { useDepotStore } from '@/store/depotStore';

/* ── tiny reusable row components ── */

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-xs text-otto-gray shrink-0">{label}</span>
    <div className="flex items-center gap-2 min-w-0">{children}</div>
  </div>
);

const Val = ({ children }: { children: React.ReactNode }) => (
  <span className="text-white text-xs font-medium tabular-nums w-10 text-right shrink-0">{children}</span>
);

const SliderRow = ({
  label, value, min, max, step = 1, suffix = '', onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string;
  onChange: (v: number) => void;
}) => (
  <Row label={label}>
    <Slider
      className="w-28"
      min={min} max={max} step={step}
      value={[value]}
      onValueChange={([v]) => onChange(v)}
    />
    <Val>{step < 1 ? value.toFixed(step < 0.1 ? 2 : 1) : value}{suffix}</Val>
  </Row>
);

const SelectRow = ({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) => (
  <Row label={label}>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-36 text-xs depot-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="depot-select-content">
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Row>
);

/* ── section wrapper ── */

const Section = ({
  value, icon: Icon, title, children,
}: {
  value: string; icon: React.ElementType; title: string; children: React.ReactNode;
}) => (
  <AccordionItem value={value} className="border-b border-white/5">
    <AccordionTrigger className="px-3 py-2 bg-otto-charcoal hover:bg-otto-charcoal/80 border-l-[3px] border-l-otto-red hover:no-underline">
      <div className="flex items-center gap-2 text-white text-sm font-medium">
        <Icon size={14} className="text-otto-red" />
        {title}
      </div>
    </AccordionTrigger>
    <AccordionContent className="px-3 pt-2 pb-3">
      <div className="flex flex-col gap-2">{children}</div>
    </AccordionContent>
  </AccordionItem>
);

/* ── main component ── */

export const ControlsTab = () => {
  const { config, updateConfig, status, setStatus, setSimSpeed, resetConfig, simSpeed } = useSimulationStore();
  const regenerateStalls = useDepotStore((s) => s.regenerateStalls);

  const upd = useCallback(
    (partial: Partial<SimulationConfig>) => {
      updateConfig(partial);
      // sync infra changes
      const next = { ...config, ...partial };
      if (
        partial.dcfcCount !== undefined ||
        partial.l2Count !== undefined ||
        partial.washBayCount !== undefined ||
        partial.stagingStalls !== undefined
      ) {
        regenerateStalls(next.dcfcCount, next.l2Count, next.washBayCount, next.stagingStalls);
      }
    },
    [config, updateConfig, regenerateStalls],
  );

  /* tier mix helper */
  const setTier = (key: 'tierCore' | 'tierConcierge' | 'tierElite', val: number) => {
    const keys: ('tierCore' | 'tierConcierge' | 'tierElite')[] = ['tierCore', 'tierConcierge', 'tierElite'];
    const others = keys.filter((k) => k !== key);
    const remaining = 100 - val;
    const otherSum = config[others[0]] + config[others[1]];
    let a: number, b: number;
    if (otherSum === 0) {
      a = Math.round(remaining / 2);
      b = remaining - a;
    } else {
      a = Math.round((config[others[0]] / otherSum) * remaining);
      b = remaining - a;
    }
    updateConfig({ [key]: val, [others[0]]: Math.max(0, a), [others[1]]: Math.max(0, b) });
  };

  const handleReset = () => {
    resetConfig();
    setSimSpeed(10);
    regenerateStalls(10, 40, 3, 15);
  };

  const allSections = ['fleet', 'consumer', 'infra', 'service', 'env', 'sim'];

  return (
    <ScrollArea className="flex-1 depot-controls">
      <Accordion type="multiple" defaultValue={allSections} className="w-full">
        {/* ── Section 1: Fleet ── */}
        <Section value="fleet" icon={Truck} title="Fleet Configuration">
          <SliderRow label="Active Fleet Size" value={config.activeFleetSize} min={1} max={200} onChange={(v) => upd({ activeFleetSize: v })} />
          <SelectRow label="Fleet Type" value={config.fleetType} options={['Ride-hail', 'Delivery', 'Corporate', 'Mixed']} onChange={(v) => upd({ fleetType: v })} />
          <SelectRow label="Arrival Pattern" value={config.fleetArrivalPattern} options={['Staggered Blocks', 'Continuous', 'Overnight Batch', 'Custom']} onChange={(v) => upd({ fleetArrivalPattern: v })} />
          <SelectRow label="Priority Level" value={config.fleetPriorityLevel} options={['Always Priority', 'Shared', 'Off-Peak Only']} onChange={(v) => upd({ fleetPriorityLevel: v })} />
          <Row label="DCFC Block Schedule">
            <Input type="time" value={config.dcfcBlockStart} onChange={(e) => upd({ dcfcBlockStart: e.target.value })} className="h-7 w-[72px] text-xs depot-input" />
            <span className="text-otto-gray text-xs">–</span>
            <Input type="time" value={config.dcfcBlockEnd} onChange={(e) => upd({ dcfcBlockEnd: e.target.value })} className="h-7 w-[72px] text-xs depot-input" />
          </Row>
          <SliderRow label="Avg SoC on Arrival" value={config.avgBatterySocArrival} min={5} max={80} suffix="%" onChange={(v) => upd({ avgBatterySocArrival: v })} />
          <SliderRow label="Target SoC Departure" value={config.targetSocDeparture} min={80} max={100} suffix="%" onChange={(v) => upd({ targetSocDeparture: v })} />
          <SliderRow label="Avg Battery (kWh)" value={config.avgBatteryCapacity} min={40} max={150} onChange={(v) => upd({ avgBatteryCapacity: v })} />
        </Section>

        {/* ── Section 2: Consumer/VIP ── */}
        <Section value="consumer" icon={Users} title="Consumer / VIP">
          <SliderRow label="Active Members" value={config.activeConsumerMembers} min={0} max={500} onChange={(v) => upd({ activeConsumerMembers: v })} />
          <div className="space-y-1">
            <span className="text-xs text-otto-gray">Tier Mix (must sum to 100%)</span>
            <SliderRow label="Core" value={config.tierCore} min={0} max={100} suffix="%" onChange={(v) => setTier('tierCore', v)} />
            <SliderRow label="Concierge" value={config.tierConcierge} min={0} max={100} suffix="%" onChange={(v) => setTier('tierConcierge', v)} />
            <SliderRow label="Elite" value={config.tierElite} min={0} max={100} suffix="%" onChange={(v) => setTier('tierElite', v)} />
          </div>
          <SelectRow label="Arrival Distribution" value={config.consumerArrivalDist} options={['Morning Rush', 'Midday', 'Evening', 'Uniform', 'Custom']} onChange={(v) => upd({ consumerArrivalDist: v })} />
          <SliderRow label="Avg SoC on Arrival" value={config.consumerAvgSoc} min={10} max={70} suffix="%" onChange={(v) => upd({ consumerAvgSoc: v })} />
          <SliderRow label="VIP Override Freq" value={config.vipOverrideFreq} min={0} max={20} suffix="%" onChange={(v) => upd({ vipOverrideFreq: v })} />
          <SliderRow label="Concierge Rate (/day)" value={config.conciergeRate} min={0} max={10} onChange={(v) => upd({ conciergeRate: v })} />
        </Section>

        {/* ── Section 3: Infrastructure ── */}
        <Section value="infra" icon={Zap} title="Infrastructure">
          <SliderRow label="DCFC Stalls" value={config.dcfcCount} min={2} max={30} onChange={(v) => upd({ dcfcCount: v })} />
          <SliderRow label="L2 Stalls" value={config.l2Count} min={10} max={80} onChange={(v) => upd({ l2Count: v })} />
          <SliderRow label="DCFC Power (kW)" value={config.dcfcPowerPerStall} min={50} max={350} onChange={(v) => upd({ dcfcPowerPerStall: v })} />
          <SliderRow label="L2 Power (kW)" value={config.l2PowerPerStall} min={7} max={19.2} step={0.1} onChange={(v) => upd({ l2PowerPerStall: v })} />
          <SliderRow label="Wash Bays" value={config.washBayCount} min={1} max={6} onChange={(v) => upd({ washBayCount: v })} />
          <SliderRow label="Staging Stalls" value={config.stagingStalls} min={5} max={30} onChange={(v) => upd({ stagingStalls: v })} />
          <SliderRow label="Solar (kWdc)" value={config.solarCanopy} min={0} max={800} onChange={(v) => upd({ solarCanopy: v })} />
          <SliderRow label="BESS (MWh)" value={config.bessCapacity} min={0} max={5} step={0.5} onChange={(v) => upd({ bessCapacity: v })} />
          <SliderRow label="BESS Power (MW)" value={config.bessPower} min={0} max={3} step={0.5} onChange={(v) => upd({ bessPower: v })} />
          <SliderRow label="Utility (MVA)" value={config.utilityService} min={1} max={10} onChange={(v) => upd({ utilityService: v })} />
        </Section>

        {/* ── Section 4: Service Times ── */}
        <Section value="service" icon={Clock} title="Service Times">
          <SliderRow label="DCFC Charge (min)" value={config.dcfcChargeTime} min={10} max={60} onChange={(v) => upd({ dcfcChargeTime: v })} />
          <SliderRow label="L2 Charge (hrs)" value={config.l2ChargeTime} min={1} max={12} step={0.5} onChange={(v) => upd({ l2ChargeTime: v })} />
          <SliderRow label="Exterior Wash (min)" value={config.exteriorWash} min={5} max={20} onChange={(v) => upd({ exteriorWash: v })} />
          <SliderRow label="Interior Detail (min)" value={config.interiorDetail} min={15} max={60} onChange={(v) => upd({ interiorDetail: v })} />
          <SliderRow label="Light Maint. (min)" value={config.lightMaintenance} min={15} max={120} onChange={(v) => upd({ lightMaintenance: v })} />
          <SliderRow label="Check-in (min)" value={config.checkInTime} min={1} max={5} onChange={(v) => upd({ checkInTime: v })} />
          <SliderRow label="Stall Transition (min)" value={config.stallTransition} min={1} max={5} onChange={(v) => upd({ stallTransition: v })} />
          <SelectRow label="Turnaround Mode" value={config.turnaroundMode} options={['Quick Turn', 'Standard', 'Overnight']} onChange={(v) => upd({ turnaroundMode: v })} />
        </Section>

        {/* ── Section 5: Environment ── */}
        <Section value="env" icon={Cloud} title="Environment & Operations">
          <SelectRow label="Weather" value={config.weather} options={['Clear', 'Rain', 'Snow', 'Extreme Heat']} onChange={(v) => upd({ weather: v })} />
          <SelectRow label="Congestion" value={config.congestionOverride} options={['Low', 'Medium', 'High', 'Critical']} onChange={(v) => upd({ congestionOverride: v })} />
          <SliderRow label="Equip. Failure Rate" value={config.equipmentFailureRate} min={0} max={15} suffix="%" onChange={(v) => upd({ equipmentFailureRate: v })} />
          <SliderRow label="Staffing Level" value={config.staffingLevel} min={2} max={8} onChange={(v) => upd({ staffingLevel: v })} />
          <SelectRow label="OTTO-Q Algorithm" value={config.ottoQAlgorithm} options={['FIFO', 'Priority-Weighted', 'SoC-Optimized', 'Revenue-Max']} onChange={(v) => upd({ ottoQAlgorithm: v })} />
          <Row label="Demand Response">
            <Switch checked={config.demandResponseMode} onCheckedChange={(v) => upd({ demandResponseMode: v })} className="depot-switch" />
          </Row>
          <SelectRow label="BESS Strategy" value={config.bessStrategy} options={['Peak Shave', 'Arbitrage', 'Backup Only']} onChange={(v) => upd({ bessStrategy: v })} />
          <SliderRow label="Energy Rate ($/kWh)" value={config.energyRate} min={0.05} max={0.30} step={0.01} suffix="" onChange={(v) => upd({ energyRate: v })} />
          <SliderRow label="Demand Charge ($/kW)" value={config.demandCharge} min={5} max={25} suffix="" onChange={(v) => upd({ demandCharge: v })} />
        </Section>

        {/* ── Section 6: Simulation Control ── */}
        <Section value="sim" icon={Play} title="Simulation Control">
          <SliderRow
            label="Speed"
            value={simSpeed}
            min={1} max={60} suffix="x"
            onChange={(v) => { setSimSpeed(v); }}
          />
          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1 bg-otto-red hover:bg-otto-red/90 text-white font-medium"
              onClick={() => status === 'running' ? simulationEngine.stop() : simulationEngine.start()}
            >
              {status === 'running' ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Run Simulation</>}
            </Button>
            <Button variant="ghost" className="text-white/60 hover:text-white" onClick={handleReset}>
              <RotateCcw size={14} />
            </Button>
          </div>
          <Button
            variant="outline"
            className="w-full border-otto-amber text-otto-amber hover:bg-otto-amber/10"
            onClick={() => {/* placeholder */}}
          >
            <AlertTriangle size={14} /> Inject Incident
          </Button>
        </Section>
      </Accordion>
    </ScrollArea>
  );
};
