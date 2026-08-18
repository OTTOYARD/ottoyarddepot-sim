# PARKED_ISAAC — Track B (Isaac Sim / Omniverse / UE photoreal) is parked per otto-q-core/CLAUDE.md 2.8.
# Not imported by the app; kept for future reattachment. Do not extend without unparking Track B.
"""
OTTOYARD — high-res beauty-still tool for the UE depot.

Frames a named camera, maxes Lumen GI / shadow / reflection quality, hides
editor gizmos, and fires a 4K HighResShot. Files land in
  <project>/Saved/Screenshots/MacEditor/HighresScreenshotNNNNN.png

USAGE — pick a preset, then exec (run after build + dress [+ dusk]):
  SHOT = "aerial"   # set in the console first, or edit the default below
  exec(open("/Users/chaseballenger/Desktop/ottoyarddepot-sim/unreal/ottoq_ue_shot.py").read())

NOTE: this is a Lumen (software-RT) still — the best achievable on macOS Metal.
True hardware PATH TRACING needs NVIDIA RTX/DXR and belongs to the Track-B
Omniverse / cloud-GPU path, not this Mac blockout.
"""

import unreal

ec = unreal.SystemLibrary.execute_console_command
ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

# named camera presets: (location, rotation=(roll,pitch,yaw)) — verified framings
CAMS = {
    # dramatic ground hero: inside the lot looking N across the lit canopies
    "hero":     (unreal.Vector(0.0, 4800.0, 1650.0),  unreal.Rotator(0.0, -6.0,  -90.0)),
    # 3/4 aerial overview: whole lit depot + surrounding city ring
    "aerial":   (unreal.Vector(0.0, 13500.0, 7200.0), unreal.Rotator(0.0, -32.0, -90.0)),
    # high top-down-ish plan view
    "plan":     (unreal.Vector(0.0, 17000.0, 12200.0), unreal.Rotator(0.0, -43.0, -90.0)),
    # gate ingress view from the public road
    "entrance": (unreal.Vector(-2330.0, 5400.0, 320.0), unreal.Rotator(0.0, -4.0, -88.0)),
}

# `SHOT` may be pre-set in the console namespace; default to the aerial.
try:
    _shot = SHOT  # noqa: F821
except NameError:
    _shot = "aerial"
loc, rot = CAMS.get(_shot, CAMS["aerial"])

eas.set_selected_level_actors([])
ues.set_level_viewport_camera_info(loc, rot)

for c in [
    "sg.PostProcessQuality 4", "sg.ShadowQuality 4",
    "sg.GlobalIlluminationQuality 4", "sg.ReflectionQuality 4",
    "sg.TextureQuality 4", "sg.EffectsQuality 4", "sg.AntiAliasingQuality 4",
    "r.Lumen.Reflections.Quality 3", "r.Lumen.ScreenProbeGather.Quality 2",
    "ShowFlag.BillboardSprites 0", "ShowFlag.Grid 0", "ShowFlag.Cameras 0",
    "ShowFlag.LightRadius 0", "r.ScreenPercentage 100",
]:
    ec(None, c)

unreal.log(f"[OTTOQ shot] '{_shot}' -> {unreal.Paths.screen_shot_dir()}")
ec(None, "HighResShot 3840x2160")
unreal.log("[OTTOQ shot] HighResShot 4K requested")
