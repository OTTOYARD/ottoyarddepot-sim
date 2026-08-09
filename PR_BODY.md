Aligns physics bookkeeping length with the 3D model (10.2u) to eliminate the mismatch.

- CAR_LENGTH updated from 9 to 10.2 in traffic.ts
- Verified with `npm run verify`: all tests pass, build succeeds
- No replay fixture changes needed — the IDM logic and tests tolerate the update
- References AGENT.md warning: this changes routed motion and required a certified pass

Closes P1-6