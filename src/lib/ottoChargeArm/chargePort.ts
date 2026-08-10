/**
 * Where is a given vehicle's charge port?
 *
 * Robotic charging only works if the robot knows where the inlet is, so the
 * depot has to model it. Three facts about the port matter:
 *
 *   SIDE    — which flank it is on.
 *   ALONG   — how far fore/aft of the vehicle's centre.
 *   HEIGHT  — how far above grade.
 *
 * ------------------------------------------------------------------------
 * MODELLING DECISION, stated plainly because it is load-bearing:
 *
 * A pedestal-mounted arm CANNOT serve a port on the far flank — it would have
 * to sweep over the vehicle, and scripts/verifyIK.mts confirms the far flank
 * sits 2.59 m out against a 1.48 m two-link span. Real depots resolve this at
 * the vehicle, not the robot: an AV chooses its approach so the inlet presents
 * to the charger, the same way a human driver picks a pump side.
 *
 * We therefore model the vehicle as ARRIVING CORRECTLY ORIENTED — the port is
 * always on the pedestal side. That is an assumption about vehicle behaviour,
 * not a fact about our sim, and it is exactly the constraint OTTO-Q has to
 * honour when it assigns a stall. The backend gate enforces the same rule so
 * the brain cannot quietly assign a vehicle that physically cannot be served.
 *
 * ALONG is likewise modelled as compliant: the AV stops so the inlet lands
 * inside the arm's service window. The residual spread below is real
 * OEM-to-OEM variation WITHIN that window, which is what makes each mate a
 * genuinely different IK solve rather than the same canned animation ten times.
 * ------------------------------------------------------------------------
 */

import { SERVICE_WINDOW } from './cobotSpec';

export interface PortSpec {
  /** Fore/aft of vehicle centre, metres. Positive = toward the vehicle's nose. */
  along: number;
  /** Height above grade, metres. */
  height: number;
  /** The OEM family this was derived from, for display. */
  family: string;
}

/** Deterministic hash so a given vehicle always presents the same port. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Port geometry by OEM family. Heights are the realistic band for each body
 * style; `along` is the nominal position the vehicle presents after stopping.
 * These are TUNABLE ASSUMPTIONS calibrated to body style, not measured data.
 */
const FAMILIES: { match: RegExp; family: string; along: [number, number]; height: [number, number] }[] = [
  { match: /tesla/i, family: 'Tesla (NACS, left rear)', along: [-0.95, -0.60], height: [0.68, 0.78] },
  { match: /waymo|jaguar|zeekr/i, family: 'Waymo (CCS1, left rear)', along: [-0.90, -0.45], height: [0.62, 0.76] },
  { match: /zoox/i, family: 'Zoox (purpose-built, mid)', along: [-0.25, 0.25], height: [0.55, 0.68] },
  { match: /cruise|origin/i, family: 'Cruise Origin (mid flank)', along: [-0.30, 0.35], height: [0.60, 0.74] },
  { match: /motional|ioniq|hyundai/i, family: 'Ioniq 5 (CCS1, right rear)', along: [-0.85, -0.50], height: [0.72, 0.84] },
  { match: /van|transit|shuttle/i, family: 'Van / shuttle (high)', along: [0.20, 0.85], height: [0.88, 1.05] },
];

const DEFAULT = { family: 'Generic AV (CCS1)', along: [-0.70, 0.70] as [number, number], height: [0.60, 0.85] as [number, number] };

/**
 * Resolve a vehicle's charge port.
 *
 * @param vehicleId stable id — the same vehicle always gets the same port
 * @param oem       backend platform string, when known
 */
export function portFor(vehicleId: string, oem?: string | null): PortSpec {
  const key = `${oem ?? ''}|${vehicleId}`;
  const spec = FAMILIES.find((f) => oem && f.match.test(oem)) ?? DEFAULT;
  const family = 'family' in spec ? spec.family : DEFAULT.family;

  const rA = hash(key + ':along');
  const rH = hash(key + ':height');
  const along = spec.along[0] + rA * (spec.along[1] - spec.along[0]);
  const height = spec.height[0] + rH * (spec.height[1] - spec.height[0]);

  // Clamp into the verified service window with a small margin. This encodes
  // "the AV stopped correctly"; it is not hiding a reach failure, it is the
  // documented parking requirement of robotic charging. Anything that needs
  // clamping here is a vehicle the depot would have had to reposition.
  const M = 0.06;
  return {
    along: Math.max(SERVICE_WINDOW.alongMin + M, Math.min(SERVICE_WINDOW.alongMax - M, along)),
    height: Math.max(SERVICE_WINDOW.heightMin + M, Math.min(SERVICE_WINDOW.heightMax - M, height)),
    family,
  };
}
