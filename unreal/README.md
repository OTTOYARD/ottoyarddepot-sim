# OTTOYARD — Unreal Engine 5 Twin (Track B)

The depot is built **procedurally inside UE5** from `sitePlan.json`, which is
exported from `src/lib/sitePlan.ts` — the same single source of truth the
simulation engine routes on and the cockpit renders. Change the layout once,
re-export, re-run the builder: every renderer stays in lockstep.

## One-time setup (~10 min)

1. **Create the project** — Epic Games Launcher → Unreal Engine 5.4/5.5 →
   Launch → **Games → Blank**, Blueprint, **☑ Starter Content** (we use its
   PBR materials for the blockout), name it `OTTOQTwin`, Create.
2. **Enable Python** — Edit → Plugins → search “Python” → enable
   **Python Editor Script Plugin** → Restart Now.

## Build / rebuild the depot

3. Window → **Output Log**. In the console row at the bottom, click the
   dropdown that says `Cmd` and switch it to **Python**.
4. Paste (adjust the path if your repo lives elsewhere) and press Enter:

   ```
   py "/Users/chaseballenger/Desktop/ottoyarddepot-sim/unreal/ottoq_ue_build.py"
   ```

   ~10 seconds later the full depot stands in the viewport: lot, fence +
   gates, BESS yard, operations building + pull-through service bays, wash
   bays, 3 PV canopies with posts, every charger pedestal, perimeter
   carports, light poles, sun/sky/clouds lighting rig.

5. Orbit with RMB + WASD. Press `G` for game view (hides editor icons).

The script is **re-runnable**: it deletes everything tagged `OTTOQ` first, so
after any `sitePlan.ts` change just run
`node scripts/exportSitePlan.mjs` and re-run step 4.

## Roadmap (in order)

- **Live state bridge** — poll the same Supabase snapshot feed the cockpit
  uses; spawn/move vehicle actors with the cockpit's exact `toWorld` math.
  (Next deliverable — Python/Blueprint hybrid, no C++ required.)
- **Realism pass** — swap blockout materials for Quixel Megascans/Fab
  surfaces (free with UE), real EV + charger meshes from Fab, decal road
  markings, Lumen GI tuning, path-traced 4K stills for the deck.
- **Pixel Streaming** — host the packaged twin on a cloud RTX box and embed
  the live photoreal viewport in the Lovable cockpit.
