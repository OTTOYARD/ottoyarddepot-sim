# What owners' agents set, in the twin (2026-10-04)

An owner's personal agent can change what its own cars need at the twin depot: how full they charge, which services
they get, when they may leave. OTTO-Q acts on it at its next tick (otto-q-core 0605-0607). These show the twin showing
it: that an agent asked, which agent, and the confirmation code OTTO-Q gave it. The read is otto-q-core 0608,
`public.ottoq_depot_owner_board`.

**Nothing shown here is live state.** The pictures are rendered over a board in 0608's exact shape, and nothing in them
is live until 0607/0608 are applied to the database. Until then the twin draws no marks and the Agent tab says "Owner
agents are built but not switched on yet (otto-q-core 0607/0608)."

| file | what it shows |
|---|---|
| `1-desktop-2d-qcard-and-agent-feed.jpg` | 2D at 1440x900. Tesla-AV-055 tapped: its Q card's "Set by its owner's agent" block (the charge limit with the agent that set it, the two service orders, each agent with its confirmation codes, "applies at OTTO-Q's next tick", the reset line). The marked Teslas carry a thin violet outline. The Agent tab beside it, and "2 agents connected" beside LIVE in the bottom bar. |
| `2-agent-feed-owner-lines.jpg` | The Agent tab's live stream: each command is its own violet OWNER line (the agent and how it connected, what it asked, OTTO-Q's receipt or its refusal, the code), placed by the sim clock it was sent at among OTTO-Q's decisions. |
| `3-desktop-3d-default-camera-marked-cars.jpg` | 3D at the default camera: a violet badge over each marked car. The cars on chargers are under the solar canopy's PV roof, and their badges are drawn over it, so they are marked from straight above too. |
| `4-desktop-3d-operator-marked-cars.jpg` | 3D from the Operator preset: the same badges in perspective, over the canopies and the bay buildings. |

## How they were made

`scripts/ownerAgentShots.mjs`: headless Chromium against the Vite dev server, every request answered from fixtures or
aborted, so nothing reached a backend and nothing was started, paused or stopped.

- **Cars and stalls:** the recorded run `src/engine/__fixtures__/twinRun.fresh0922.json`, as `qCardShots.mjs` serves it.
- **Decision stream:** run 1ccad49b's real decisions (`src/components/tabs/__fixtures__/ottoqRun.1ccad49b.json`; the
  twin's fleet ids do not change between runs), re-timed onto the recording's clock.
- **The tapped car's depot card:** adapted from the contract-shaped stub sample `qCardShots.mjs` uses (here an L2
  charge, the car's state in the recording; values illustrative). Every other car's card is the recording's state only.
- **The owner board:** built from the real 0608 capture
  (`src/components/tabs/__fixtures__/depotOwnerBoard.0608.json`, a scratch database with 0559-0608 applied): its two
  agents (one connected with an issued key, one with a passcode), its receipt sentences, and its objects, cloned so
  every key is the function's own. The script compares the served board's key sets with the capture's, object by
  object, and found no difference. It is re-keyed to the twin's 36 real Teslas: the key agent set all 36 to 90%; the
  passcode agent ordered an exterior wash on every return for four of them and mechanical PM for Tesla-AV-055, held
  Tesla-AV-070, and was refused twice. The confirmation codes and command ids are synthetic.

A headless browser renders 3D in software (about 1 frame a second): these show placement and words, not smoothness.
