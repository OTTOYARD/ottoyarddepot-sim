// ============================================================================
// siteFeeders — every fast-charger post's 480 V feed, routed on the site plan from the transformer that feeds it.
//
// Chase, 2026-11-15, asked where the chargers' power electronics should stand: "All-in-one posts". Each post is a whole
// 350 kW charger (cad/otto_cad/robots/charge_cabinet.py), fed with 480 V AC from its charger transformer: otto-q-core 0810's
// one-line, six transformers of five posts each, one per canopy column (TX-A1 feeds DCFC-01..05, ..., TX-C2 feeds
// DCFC-26..30). The transformers stand in the transformer yard behind the office (sitePlan.CHARGER_TRANSFORMERS). This file
// routes each post's feed through one duct bank and measures it, so the cable schedule can quote each post's length
// instead of leaving it open. It is the 30-post build's (chargerBuild dcfc30), the depot the twin has (otto-q-core 0763).
//
// THE ROUTE (ASSUMPTION: the site's civil design sets it; this is the shortest that keeps out of every building and yard):
//   1. from the transformer south, under the transformer yard's working room, to the duct bank along the yard's south fence;
//   2. west along it to the strip between the battery yard and the office (x = 68, the transformer yard's west fence);
//   3. south down that strip, past the battery yard and the office, to under the forecourt (sitePlan.FORECOURT_Y);
//   4. east under the forecourt to the post's canopy's spine;
//   5. south under the canopy's slab, along its spine, to the post's row, then across to the post's pad.
// It goes round the office, not under it: a duct bank under a building is the civil design's choice, not one to make here.
//
// THE LENGTH a conductor is bought by: the route x 1.03 (its lie in the duct) + 2.75 m (ASSUMPTION: 1.5 m up into the
// transformer's cable compartment, 0.75 m up from the duct bank to the pad's underside, 0.5 m to make it off at the
// transformer). The piece from the pad's underside to the charger's lug is the CAD's (charge_cabinet.py), not counted here.
//
// THE NETWORK runs in the same duct bank from the depot's network switch, which this file stands in the office on its west
// wall (ASSUMPTION). A twisted-pair Ethernet channel may be at most 100 m, 90 m of fixed cable and 10 m of cords
// (ANSI/TIA-568-B: https://www.csd.uoc.gr/~hy435/material/Cabling%20Standard%20-%20ANSI-TIA-EIA%20568%20B%20-%20Commercial
// %20Building%20Telecommunications%20Cabling%20Standard.pdf, read through a web search on 2026-11-15), and the farthest posts
// are further than that, so the site's network cable is single-mode fibre (siteFeeders.test.ts holds the reason true).
//
// THE VOLTAGE DROP is checked, not assumed: standard annealed copper is 1/58 ohm mm2/m at 20 °C (IEC 28, the International
// Annealed Copper Standard: https://cabledatasheet.com/cable-handbook/the-international-annealed-copper-standard) and its
// resistance rises 0.00393 per °C (https://www.ipc.org/sites/default/files/test_methods_docs/2.5.14a.pdf, both read through a
// web search on 2026-11-15). At 75 °C, with 2 % for the stranding (ASSUMPTION), 2 conductors of 350 kcmil a phase.
// ============================================================================
import { BESS_YARD, BUILDING, CANOPIES, CHARGER_TRANSFORMERS, FORECOURT_Y, TX_YARD, generateStallsV2 } from './sitePlan';
import { cabinetFootprints } from './structurePlan';

const M = 0.4785;                                       // metres per plan unit (sitePlan's yardstick)

/** The duct bank's fixed legs, plan units. */
export const FEEDER_ROUTE = {
  /** along the transformer yard's south fence, under the working room in front of the units */
  yardY: TX_YARD.y + TX_YARD.h - 2,
  /** the strip between the battery yard's east fence and the office's west wall: the transformer yard's west fence */
  stripX: TX_YARD.x,
  /** under the forecourt */
  forecourtY: FORECOURT_Y,
} as const;

/** Where the depot's network switch stands (ASSUMPTION): in the office, on its west wall. */
export const NETWORK_SWITCH = { x: BUILDING.x, y: BUILDING.y + BUILDING.h / 2 } as const;

/** What a conductor is bought by, beyond its route (ASSUMPTION: see the header). */
export const FEEDER_ALLOWANCE = { lie: 1.03, endsM: 2.75 } as const;
/** The network's: the drops and a service loop at each end (ASSUMPTION). */
export const NETWORK_ALLOWANCE = { lie: 1.03, endsM: 3.0 } as const;

/** The feed: 480 V, 3 phase, at 350 kW out (ASSUMPTION: 95 % efficient, power factor 0.99), 2 conductors of 350 kcmil a phase. */
export const FEED = {
  volts: 480,
  amps: 350e3 / 0.95 / (Math.sqrt(3) * 480 * 0.99),
  /** ohm per metre of one 350 kcmil copper conductor at 75 °C (IACS, +2 % for the stranding) */
  ohmPerM: (1 / 58) * (1 + 0.00393 * (75 - 20)) * 1.02 / (350_000 * 5.067e-4),
  perPhase: 2,
} as const;

export interface PostFeeder {
  /** the renderer's stall id (the twin's is NASH-<id>) */
  post: string;
  transformer: string;
  /** the route, plan units, from the transformer's middle to the post's pad */
  route: { x: number; y: number }[];
  /** the route's length, metres */
  routeM: number;
  /** a conductor's length in the duct bank, metres (route x lie + ends) */
  acM: number;
  /** the network fibre's run from the office's switch, metres */
  netM: number;
  /** the voltage drop at full load, per cent of 480 V */
  dropPct: number;
}

const pathLength = (pts: { x: number; y: number }[]): number =>
  pts.slice(1).reduce((s, p, i) => s + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** Every post's feed in the 30-post build, by post. */
export function postFeeders(): PostFeeder[] {
  const stalls = generateStallsV2(30, 0);
  const pads = new Map(cabinetFootprints(stalls).filter((k) => k.dc).map((k) => [k.stallId, k.box]));
  const out: PostFeeder[] = [];
  for (const s of stalls) {
    if (s.type !== 'dcfc') continue;
    const n = Number(s.id.slice(-2));
    const tx = CHARGER_TRANSFORMERS[Math.floor((n - 1) / 5)];
    const pad = pads.get(s.id)!;
    const canopy = CANOPIES.reduce((best, c) => (Math.abs(c.cx - s.position.x) < Math.abs(best.cx - s.position.x) ? c : best));
    const { yardY, stripX, forecourtY } = FEEDER_ROUTE;
    const route = [
      { x: tx.x, y: tx.y }, { x: tx.x, y: yardY }, { x: stripX, y: yardY }, { x: stripX, y: forecourtY },
      { x: canopy.cx, y: forecourtY }, { x: canopy.cx, y: pad.cy }, { x: pad.cx, y: pad.cy },
    ];
    const routeM = pathLength(route) * M;
    const acM = routeM * FEEDER_ALLOWANCE.lie + FEEDER_ALLOWANCE.endsM;
    const net = [
      { x: NETWORK_SWITCH.x, y: NETWORK_SWITCH.y }, { x: stripX, y: NETWORK_SWITCH.y }, { x: stripX, y: forecourtY },
      { x: canopy.cx, y: forecourtY }, { x: canopy.cx, y: pad.cy }, { x: pad.cx, y: pad.cy },
    ];
    const netM = pathLength(net) * M * NETWORK_ALLOWANCE.lie + NETWORK_ALLOWANCE.endsM;
    const ohmPhase = (FEED.ohmPerM * acM) / FEED.perPhase;
    const dropPct = (100 * Math.sqrt(3) * FEED.amps * ohmPhase) / FEED.volts;
    out.push({ post: s.id, transformer: tx.code, route, routeM, acM, netM, dropPct });
  }
  return out;
}

/** The yards and buildings a route may not cross (the transformer yard is where every route starts). */
export function feederKeepOuts(): { name: string; x0: number; x1: number; y0: number; y1: number }[] {
  return [
    { name: 'battery yard', x0: BESS_YARD.x, x1: BESS_YARD.x + BESS_YARD.w, y0: BESS_YARD.y, y1: BESS_YARD.y + BESS_YARD.h },
    { name: 'office and service bays', x0: BUILDING.x, x1: BUILDING.x + BUILDING.w, y0: BUILDING.y, y1: BUILDING.y + BUILDING.h },
  ];
}
