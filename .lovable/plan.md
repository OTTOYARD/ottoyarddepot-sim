

# Add NVIDIA cuOpt Integration via Edge Function

## Problem
The provided code calls the NVIDIA API directly from the client using `import.meta.env.VITE_NVIDIA_API_KEY`. The key is stored as a **runtime secret** (not a VITE_ env var), so it's only accessible from edge functions. Exposing API keys client-side is also a security risk.

## Approach
Split into an edge function (holds the key, calls NVIDIA) and a client-side library (calls the edge function, provides fallback).

## Changes

### 1. `supabase/functions/cuopt-optimize/index.ts` — New edge function
- Reads `NVIDIA_API_KEY` from `Deno.env`
- Accepts the same `DepotOptRequest` payload
- Builds the cuOpt request, calls NVIDIA API, returns parsed results
- Returns fallback result if API fails or key missing

### 2. `src/lib/nvidia-cuopt.ts` — New client library
- Same types/interfaces as user provided
- `optimizeDepotSchedule()` calls the edge function via `supabase.functions.invoke('cuopt-optimize', ...)`
- Contains the `fallback()` function for when the edge function fails
- No direct API key reference

### 3. No integration into SimulationEngine yet
This creates the library. A follow-up step would wire it into the scheduling system or add a "cuOpt" option to the algorithm dropdown.

