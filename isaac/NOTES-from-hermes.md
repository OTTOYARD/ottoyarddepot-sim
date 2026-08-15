# RTX Streaming — Wiring, Security Groups & Current Diagnosis (from Hermes → Claude)

**Purpose:** Claude, please take over diagnosing why the RTX tab (OmniverseViewer) is showing
"no movement / console UI / not visible" after it worked the prior night. Everything you need to
find and inspect the stack is below. No secrets are included — SSH key and Supabase keys already
live in your env.

---

## 1. Topology (exact wiring)

```
Lovable React app (OmniverseViewer.tsx)
   │  @nvidia/ov-web-rtc@6.6.0  (authenticate:true, direct mode, no broker)
   │  connects to: rtx.ottoyard.com:443  (HTTPS / WSS)
   ▼
nginx (TLS termination, certbot cert)
   │  server_name rtx.ottoyard.com
   │  proxy_pass http://127.0.0.1:49100   (WebSocket /sign_in signaling)
   ▼
Isaac Sim 6.0.1 streaming app (headless, on the GPU box)
   │  omni.kit.livestream.webrtc  — signaling on TCP 49100
   │  media (RTP/RTCP) on UDP 47998
   ▼
The GPU instance renders the depot + drives vehicles (OttoMotion)
```

### Name server / DNS
- `rtx.ottoyard.com` → **A record → `54.166.168.193`** (this is the **Elastic IP**, permanent across
  stop/start; the older `18.232.56.240` and `34.239.177.167` are stale and must NOT be used).
- TLS cert issued by certbot, live at `/etc/letsencrypt/live/rtx.ottoyard.com/`
  (`fullchain.pem` / `privkey.pem`).

### EC2 instance
- Type **`g5.2xlarge`** (NVIDIA A10G, 22 GiB), Isaac Sim **6.0.1** in a Python venv at
  `/home/ubuntu/isaacsim-env`.
- SSH: `ssh -i /opt/data/ottoq-hermes.pem ubuntu@54.166.168.193`  (key is on the Hermes host at
  `/opt/data/ottoq-hermes.pem`; Claude may already have an equivalent path).

### Security group (exact inbound rules — verify these are ALL present on the instance's SG)
| Proto | Port  | Purpose |
|-------|-------|---------|
| TCP   | 22    | SSH |
| TCP   | 80    | HTTP (certbot / redirect) |
| TCP   | 443   | HTTPS / WSS (nginx TLS proxy) |
| TCP   | 49100 | WebRTC signaling (Kit) |
| TCP   | 47998 | WebRTC media (TCP fallback) |
| UDP   | 47998 | WebRTC media (real-time RTP/RTCP) |

⚠️ **Known trap:** the NVIDIA-AMI auto-generated security group has, in the past, **removed UDP 47998**.
Re-check the SG after any AMI reprovision. Outbound ephemeral TCP/UDP must be open for return traffic.

### Nginx
- Site file: `/etc/nginx/sites-enabled/rtx`
- Key line: `proxy_pass http://127.0.0.1:49100;`  (WebSocket `Upgrade`/`Connection` headers must be
  forwarded — confirm the `proxy_set_header Upgrade $http_upgrade;` block is present).
- Reload: `sudo nginx -s reload`. Access log `/var/log/nginx/access.log`, error log
  `/var/log/nginx/error.log`.

### systemd streaming service
- `/etc/systemd/system/ottoq-stream.service`
- `ExecStart=/home/ubuntu/isaacsim-env/bin/python -u /home/ubuntu/stream_depot_canonical.py`
- `Environment=PUBLIC_IP=54.166.168.193`, `Environment=ACCEPT_EULA=1`, `User=ubuntu`.
- Restart: `sudo systemctl restart ottoq-stream`; logs append to `/home/ubuntu/stream.log`.

---

## 2. Current state / what changed (the regression)

**It worked the prior night. Today's edits touched these files, then it broke:**

- `stream_depot_canonical.py` (the stream bootstrap) — Hermes added explicit
  `signalPort`/`streamPort` carb settings and flipped `hideUi`, and later removed them.
- Depot rebuilt from `unreal/layoutSeed.json` (feet, y-NORTH-positive) instead of the stale
  `sitePlan.json` — this changed the `.usda` geometry and the coordinate frame.
- Motion source switched to `otto_motion_canonical.py` (OttoMotion) + `canonical_vehicle.py`
  (feet→cm, Tesla scale/ground offset).
- Light/exposure retune: DistantLight `12000`→`4000`, DomeLight `6000`→`3000`, added `exposure=0`,
  asphalt albedo `0.045`→`0.15`.

**What Hermes has already verified (server-side, as of the latest session):**
- WebSocket `/sign_in` handshake returns **HTTP 101** (signaling is UP).
- No `NVST_R_BUSY` in the log since the last clean restart.
- Motion loop: `[MOTION] poll=N targets=116 placed=~44-50` (OttoMotion is running).
- A high-angle `omni.replicator` render shows the depot renders correctly (well-lit, good contrast).

**What is still broken (Chase's report):**
- RTX tab shows "the whole console" (Kit editor chrome) and **no movement**, or is not visible at all.

---

## 3. Root-cause notes (do not relearn these — they are hard-won)

- **WebRTC library:** must be `@nvidia/ov-web-rtc@6.6.0` in the Lovable app. The old
  `@nvidia/omniverse-webrtc-streaming-library@5.6.0` produced a bare-WS proxy **501** against Kit 110.
- **`hide_ui`:** passing `hide_ui=True` to `SimulationApp` **breaks signaling**. Use the carb
  alternative `settings.set("/app/window/hideUi", True)` instead. The current bootstrap sets
  `hide_ui: False` in the constructor + carb `hideUi=True` right after.
- **Ports:** the WebRTC extension only accepts signaling on **49100**. Explicitly setting
  `signalPort`/`streamPort` carb keys misrouted it (it bound 8011 → every handshake returned **403**).
  Leave ports at the omniverse defaults and let nginx forward 443→49100.
- **`NVST_R_BUSY`** = a stale WebRTC session held by the browser; a clean `ottoq-stream` restart +
  a full browser tab close/reopen (not just refresh) clears it.
- **Renderer:** shaded (`settings.set("/rtx/rendermode", "shaded")`) — path tracing never converged
  in headless streaming.
- **Mixed content:** an HTTPS page cannot open `ws://`; the nginx TLS proxy (`wss://rtx.ottoyard.com`)
  is mandatory.

---

## 4. Where to look (on the box)

- `/home/ubuntu/stream.log` — streaming app log (`[STREAM]`, `[MOTION]`, `[ARM]`, NVST errors).
- `/home/ubuntu/stream_depot_canonical.py` — the streaming bootstrap.
- `/home/ubuntu/otto_motion_canonical.py` — vehicle motion adapter (feet/y-north, from_x chaining).
- `/home/ubuntu/canonical_vehicle.py` — Tesla builder + `feet_to_cm`.
- `/home/ubuntu/ottoyard_depot.usda` — regenerated depot.
- `/home/ubuntu/layoutSeed.json` — canonical layout (feet, y-north).
- Repo (this branch): `isaac/otto_motion_canonical.py`, `isaac/canonical_vehicle.py`,
  `isaac/stream_depot_canonical.py`, `unreal/ottoq_usd_build.py`, `unreal/layoutSeed.json`.

## 5. Suggested first probes

1. Confirm the Lovable `OmniverseViewer.tsx` on `main` still targets `rtx.ottoyard.com:443`
   (not a stale IP) and `SIGNALING_PORT=49100`, and that `authenticate` matches the server.
2. On the box: `ss -tlnp | grep 49100` and `ss -ulnp | grep 47998` (media port MUST be bound).
3. `sudo tail -f /var/log/nginx/error.log` while Chase opens the RTX tab — watch for 403/502/upstream.
4. Check whether the Kit editor chrome is actually hidden (the `hideUi=True` carb setting) — Chase
   sees "the whole console", so either it's not taking effect or the viewport is black behind it.
5. If you can, add an in-stream frame capture (`omni.replicator` on the live viewport) so we stop
   asking Chase to describe what he sees.

---

## 6. Cold-start runbook (bring the box back from powered-off)

> **Status (2026-08-15):** live WebRTC streaming is PAUSED — Omniverse WebRTC DIRECT mode serves one
> viewer at a time (`NVST_R_BUSY`), which structurally cannot deliver a shareable multi-viewer link.
> The box is being powered down. Everything below restores the instance to the last-known state. If we
> return to Isaac it will be for **offline hero renders**, not live streaming — start from these
> files, not from scratch.

**1. Start the instance + confirm the Elastic IP.**
- The Elastic IP is **`54.166.168.193`** (permanent across stop/start). If the instance was stopped,
  confirm the EIP is still attached (EC2 → Elastic IPs → Association). Do NOT use the stale IPs
  `18.232.56.240` or `34.239.177.167`.
- Instance type `g5.2xlarge` (A10G). If it was terminated (not stopped), you must recreate it from
  the NVIDIA Isaac Sim AMI + re-attach the EIP + re-add the security-group rules below.

**2. Security group — re-add these inbound rules (NVIDIA AMI SGs drop UDP 47998):**
TCP 22 (SSH), TCP 80, TCP 443, TCP 49100, TCP 47998, UDP 47998. Outbound ephemeral open.

**3. SSH in and confirm the pieces are present:**
```bash
ssh -i /opt/data/ottoq-hermes.pem ubuntu@54.166.168.193
ls /home/ubuntu/stream_depot_canonical.py /home/ubuntu/ottoyard_depot.usda /home/ubuntu/layoutSeed.json
ls /home/ubuntu/isaacsim-env/bin/python   # the venv with Isaac Sim 6.0.1
```
If the venv is missing (fresh instance), rebuild it with Isaac Sim 6.0.1 (the `isaacsim` pip
installer / Omniverse Launcher), then re-copy every file in this repo's `isaac/` directory to
`/home/ubuntu/`.

**4. Restore nginx (TLS → WebSocket proxy):**
```bash
sudo cp /home/ubuntu/nginx-rtx.conf /etc/nginx/sites-enabled/rtx
sudo nginx -t && sudo systemctl reload nginx
```
The config already points `proxy_pass http://127.0.0.1:49100` with `Upgrade`/`Connection` headers.
Cert lives at `/etc/letsencrypt/live/rtx.ottoyard.com/` (renew with certbot if expired).

**5. Restore the systemd unit + start:**
```bash
sudo cp /home/ubuntu/ottoq-stream.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ottoq-stream
tail -f /home/ubuntu/stream.log   # expect [STREAM] loaded …, [MOTION] poll=… targets=…
```

**6. Verify:**
```bash
ss -tlnp | grep 49100        # signaling bound
curl -sk -o /dev/null -w '%{http_code}' \
  -H 'Upgrade: websocket' -H 'Connection: Upgrade' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'http://127.0.0.1:49100/sign_in?peer_id=1&version=2&peer_role=1'
# expect: 101
```

**7. For offline hero renders** (the future path), reuse the `omni.replicator` render scripts that
were proven end-to-end: `render_check2.py` (burial/contrast check), `render_high.py` (high-angle
depot view). They load `ottoyard_depot.usda`, tune the lights, place Teslas via `canonical_vehicle.py`,
and write a PNG you can `scp` back. No WebRTC needed.

**Files kept in this repo (`isaac/`) for the restart:**
`stream_depot_canonical.py` (bootstrap), `otto_motion_canonical.py` (motion adapter),
`canonical_vehicle.py` (Tesla builder + `feet_to_cm`), `arm_builder_canonical.py` (arm geometry),
`arm_animator_canonical.py` (arm animation, per-phase joint lerp), `live_bridge_canonical.py`
(legacy edge bridge), `otto_motion.py` (Claude's base), `nginx-rtx.conf`, `ottoq-stream.service`,
plus `unreal/ottoq_usd_build.py` + `unreal/layoutSeed.json` (depot geometry source of truth).

