// ============================================================================
// fixturePlayback — serve a RECORDED twin run to the cockpit running in a
// Playwright page, READ-ONLY. Shared by cockpitPlayback.mjs (look at motion)
// and perfHarness.mjs (measure rendering), so both see the same world.
//
// The page's run list, snapshot and per-run RPCs are answered for a SYNTHETIC
// run id from the fixture, on the wall clock (frame wall_ms, sim clock advanced
// at the fixture's speedX). Everything else passes through to the backend
// READ-ONLY: any request that is not a GET or an ottoq_twin_* read RPC is
// refused before it leaves the browser. Nothing touches the database.
// ============================================================================
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RUN = "f1f1f1f1-0922-4000-8000-000000000001"; // synthetic: never a real run id
const DEPOT = "11111111-1111-1111-1111-111111111111"; // the twin depot, the only test site

export function loadFixture(root, name) {
  const F = JSON.parse(readFileSync(join(root, "src/engine/__fixtures__", `twinRun.${name}.json`), "utf8"));
  if (!F.frames.every((f) => typeof f.wall_ms === "number")) {
    throw new Error(`twinRun.${name}.json carries no wall clock (wall_ms) — only wall-paced captures can be played`);
  }
  return F;
}

/** GET through curl (it trusts the system CA bundle the sandbox proxy is signed by). */
function viaCurl(method, url, headers, body) {
  const args = ["-sS", "-m", "30", "-X", method, "-D", "-", "-o", "-"];
  for (const [k, v] of Object.entries(headers)) {
    if (!/^(host|content-length|connection|accept-encoding)$/i.test(k)) args.push("-H", `${k}: ${v}`);
  }
  if (body) args.push("--data-binary", "@-");
  args.push(url);
  return new Promise((res, rej) => {
    const p = execFile("curl", args, { encoding: "buffer", maxBuffer: 64e6 }, (err, out) => {
      if (err) return rej(err);
      // -D - prints every header block (a proxy's CONNECT reply, a 100-continue,
      // then the response): keep consuming while the remainder starts with HTTP/
      let rest = out, status = 0, hdrs = {};
      while (rest.subarray(0, 5).toString("latin1") === "HTTP/") {
        const i = rest.indexOf("\r\n\r\n");
        if (i < 0) break;
        const lines = rest.subarray(0, i).toString("latin1").split("\r\n");
        status = Number(lines[0].split(" ")[1]);
        hdrs = {};
        for (const l of lines.slice(1)) { const j = l.indexOf(":"); if (j > 0) hdrs[l.slice(0, j).trim().toLowerCase()] = l.slice(j + 1).trim(); }
        rest = rest.subarray(i + 4);
      }
      for (const h of ["content-encoding", "transfer-encoding", "content-length", "set-cookie"]) delete hdrs[h];
      hdrs["access-control-allow-origin"] = "*";
      res({ status, headers: hdrs, body: rest });
    });
    if (body) p.stdin.write(body);
    p.stdin.end();
  });
}

const reply = (route, body) => route.fulfill({
  status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body),
});

/**
 * Route the page's backend traffic through the fixture. Returns a handle whose
 * `playbackSeconds()` is the fixture time being served (-1 before the first
 * snapshot request) and whose `refused` counts blocked writes.
 *
 *   noRun           answer the run list with NO run, so the cockpit shows its
 *                   idle state (the top bar's Start) — nothing is played
 *   mutateSnapshot  (snap) => snap: change the served frame before it leaves,
 *                   e.g. add `stalls_status` rows to show a faulted charger
 */
export async function installFixtureRoutes(page, F, { relay = false, noRun = false, mutateSnapshot = null } = {}) {
  let t0 = null, ticks = 0;
  const h = {
    refused: 0,
    /** what was refused, "METHOD /path" (RPC reads outside ottoq_twin_* are refused too) */
    refusedRequests: new Set(),
    playbackSeconds: () => (t0 === null ? -1 : (Date.now() - t0) / 1000),
  };

  /** The fixture's world at `ms` of playback, in the snapshot endpoint's shape. */
  function snapshotAt(ms) {
    const states = new Map();
    let last = F.frames[0];
    for (const f of F.frames) {
      if (f.wall_ms > ms) break;
      for (const c of f.changes) c.state === "__gone__" ? states.delete(c.id) : states.set(c.id, c);
      last = f;
    }
    const vehicles = F.roster.filter((r) => states.has(r.id)).map((r) => {
      const s = states.get(r.id);
      return { id: r.id, av_id: r.av_id, make: r.make, platform: r.platform, state: s.state, soc: r.soc, stall_id: s.stall_id };
    });
    const counts = {};
    for (const v of vehicles) counts[v.state] = (counts[v.state] ?? 0) + 1;
    return {
      run: {
        sim_run_id: RUN, scenario: "busy_day", status: "running", tick_count: ++ticks, time_scale: 60, seed: 1,
        sim_clock: new Date(Date.parse(last.t) + (ms - last.wall_ms) * (F.speedX ?? 1)).toISOString(),
        speed_x: F.speedX ?? 1, playback_mode: "live", jump: null,
      },
      legs: [], fleet: { counts, total: vehicles.length, vehicles }, stalls_status: [],
      energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
    };
  }

  await page.route(/supabase\.co/, async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    const m = r.method();
    if (m === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" } });
    }
    // the fixture's run
    if (/\/otto-twin-control\/sim_runs$/.test(u.pathname) && m === "GET") {
      return reply(route, { ok: true, data: { runs: noRun ? [] : [{ sim_run_id: RUN, scenario: "busy_day", status: "running", speed_x: F.speedX, tick_count: ticks, seed: 1 }] } });
    }
    if (u.pathname.includes(`/sim_runs/${RUN}/snapshot`)) {
      if (t0 === null) t0 = Date.now();
      const snap = snapshotAt(Date.now() - t0);
      return reply(route, { ok: true, data: mutateSnapshot ? mutateSnapshot(snap) : snap });
    }
    if (u.pathname.includes(`/sim_runs/${RUN}`)) return reply(route, { ok: false, error: "fixture playback" });
    const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname)?.[1];
    if (rpc && (r.postData() ?? "").includes(RUN)) {
      return reply(route, rpc === "ottoq_twin_run_context" ? { depot_id: DEPOT, sim_run_id: RUN } : { error: "fixture playback" });
    }
    // READ-ONLY for everything else
    if (m !== "GET" && !(m === "POST" && rpc?.startsWith("ottoq_twin_"))) {
      h.refused++;
      h.refusedRequests.add(`${m} ${u.pathname}`);
      return reply(route, { ok: false, error: "refused by fixture playback (read-only)" });
    }
    if (!relay) return route.continue();
    try { await route.fulfill(await viaCurl(m, r.url(), r.headers(), r.postDataBuffer())); }
    catch { await route.abort(); }
  });
  return h;
}
