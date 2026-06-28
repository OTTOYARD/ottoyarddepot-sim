// Export the canonical site plan (src/lib/sitePlan.ts) to unreal/sitePlan.json
// for external renderers (Unreal Engine, Omniverse/USD, ...).
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

await build({
  entryPoints: ['src/lib/sitePlan.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: '/tmp/ottoq_siteplan.cjs',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const sp = require('/tmp/ottoq_siteplan.cjs');

const out = {
  meta: {
    source: 'src/lib/sitePlan.ts',
    exportedAt: new Date().toISOString(),
    units: { logical: 1, feet: 1.57, ueCm: 48 },
    coords: 'logical x 0..300 west->east, y 0..220 north->south',
  },
  lot: sp.LOT,
  gateW: sp.GATE_W,
  ingress: sp.INGRESS,
  egress: sp.EGRESS,
  bessYard: sp.BESS_YARD,
  building: sp.BUILDING,
  wash: sp.WASH,
  canopies: sp.CANOPIES,
  parkRuns: sp.PARK_RUNS,
  lightPoles: sp.LIGHT_POLES,
  lanes: {
    westAisleX: sp.WEST_AISLE_X, eastAisleX: sp.EAST_AISLE_X,
    northLaneY: sp.NORTH_LANE_Y, southLaneY: sp.SOUTH_LANE_Y,
    rearLaneY: sp.REAR_LANE_Y, forecourtY: sp.FORECOURT_Y,
    westLinkX: sp.WEST_LINK_X, tempLaneX: sp.TEMP_LANE_X,
    gapLanes: sp.GAP_LANES, queueY: sp.QUEUE_Y,
  },
  stalls: sp.generateStallsV2(),
};

mkdirSync('unreal', { recursive: true });
writeFileSync('unreal/sitePlan.json', JSON.stringify(out, null, 2));
console.log('EXPORTED unreal/sitePlan.json — stalls:', out.stalls.length, '— canopies:', out.canopies.length);
