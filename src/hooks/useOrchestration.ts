// ============================================================================
// useOrchestration — runs the OTTO-Q funnel once per world frame.
//
// One pass per TICK, not per poll: the snapshot is polled every 1.5s but the
// world only advances on a server tick, so re-deciding on an unchanged frame
// would emit duplicate commands (idempotency would absorb them, but the ledger
// would be full of noise and the shield would burn its per-target budget).
//
// Ordering inside a pass is deliberate:
//   1. expire commands whose window has closed  — free the targets first
//   2. run the funnel                            — decide against a clean slate
//   3. transmit                                  — one batch, one wire
//
// Nothing here moves a vehicle or sets a power level. The executor does that,
// and today the executor honestly rejects most of what it is handed (see
// commandBus.twinExecutor) because the twin has no subscriber for it yet.
// ============================================================================
import { useEffect, useRef } from "react";
import { CommandBus, twinExecutor } from "@/lib/ottoq/commandBus";
import { defaultAdvisors } from "@/lib/ottoq/advisors";
import { runPipeline } from "@/lib/ottoq/pipeline";
import {
  drainEnergyOutcomes, drainMotionOutcomes, energySubscriber, motionSubscriber,
} from "@/lib/ottoq/executors";
import { SiteEnergyController } from "@/lib/ottoq/energyController";
import { useWorldStore } from "@/store/worldStore";
import { useOrchestrationStore } from "@/store/orchestrationStore";

export function useOrchestration(enabled = true) {
  const bundle = useWorldStore((s) => s.bundle);
  const phase = useWorldStore((s) => s.phase);
  const busRef = useRef<CommandBus | null>(null);
  const energyRef = useRef<SiteEnergyController | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const runIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !bundle) return;
    // Boot must have finished. `incomplete` is still allowed through — the
    // shield makes the per-frame call about whether the world is good enough to
    // act on, and it does so with reasons. Refusing here instead would hide
    // that reasoning from the operator.
    if (phase === "loading" || phase === "idle") return;

    // New run: a fresh ledger. Sequence numbers and idempotency keys are only
    // meaningful within one run.
    if (runIdRef.current !== bundle.sim_run_id) {
      runIdRef.current = bundle.sim_run_id;
      // Seed the energy controller from the world's own battery so its model
      // starts where the twin actually is, not at a guess.
      const controller = new SiteEnergyController(
        bundle.channels.energy_grid.payload.bess.soc_pct ?? 60,
      );
      energyRef.current = controller;
      busRef.current = new CommandBus(
        twinExecutor({
          vehicle: motionSubscriber(),
          energy: energySubscriber(controller),
          // charger + depot still have no subscriber; twinExecutor refuses
          // those by name rather than pretending they landed.
        }, "twin"),
      );
      lastTickRef.current = null;
      useOrchestrationStore.getState().reset();
    }

    // One decision per tick.
    if (lastTickRef.current === bundle.tick) return;
    if (inFlightRef.current) return;
    lastTickRef.current = bundle.tick;

    const bus = busRef.current!;
    const store = useOrchestrationStore.getState();
    inFlightRef.current = true;

    (async () => {
      try {
        // 0. advance the energy controller to this frame's clock BEFORE
        //    deciding, so the ramp and the state-of-charge integration reflect
        //    the last directive by the time the advisors read the world.
        const controller = energyRef.current!;
        controller.step(bundle.sim_clock, bundle.channels.energy_grid.payload.bess.temp_c);

        // 1. close out anything the executors finished or refused since the
        //    last pass, then expire whatever timed out. Both free their targets
        //    before the shield counts open commands against them.
        const atSim = bundle.sim_clock ?? "";
        for (const outcome of [...drainMotionOutcomes(atSim), ...drainEnergyOutcomes(controller, atSim)]) {
          bus.complete(outcome);
        }
        const expired = bus.expireStale(bundle.sim_clock);

        const result = await runPipeline({
          advisors: defaultAdvisors(),
          bundle,
          openCommands: bus.openCommands,
          sequenceStart: bus.sequenceStart,
        });

        const transmit = await bus.transmit(result.batch);
        store.recordPass({
          energy: controller.state,
          tick: bundle.tick,
          batch: result.batch,
          advisorRuns: result.advisorRuns,
          trace: result.trace,
          transmit,
          expired,
          ledger: bus.stats(),
        });
      } catch (e) {
        store.recordError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [bundle, phase, enabled]);
}
