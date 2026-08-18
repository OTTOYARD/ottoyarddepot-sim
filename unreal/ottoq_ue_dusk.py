# PARKED_ISAAC — Track B (Isaac Sim / Omniverse / UE photoreal) is parked per otto-q-core/CLAUDE.md 2.8.
# Not imported by the app; kept for future reattachment. Do not extend without unparking Track B.
"""
OTTOYARD — dusk / golden-hour lighting pass for the UE depot.

Two jobs:
  1. Retune the existing sky rig (OTTOQ_Sun / SkyLight / Fog / PPV) to a low,
     warm golden-hour key with volumetric haze and a glow-friendly exposure.
  2. Add REAL local lights — emissive meshes (windows, charger LEDs, office
     interior, canopy strips) look lit but cast no light, so the lot would
     read flat at dusk. We drop warm pole-head spots over the yard, cool
     wash lights under each charging canopy, and security spots at the gates.

Re-runnable: every light it spawns is tagged OTTOQL and cleared on re-run.
Run AFTER build + dress:
  exec(open("/Users/chaseballenger/Desktop/ottoyarddepot-sim/unreal/ottoq_ue_dusk.py").read())
To return to daytime, re-run ottoq_ue_build.py (its lighting_rig resets the sun)
then ottoq_ue_dress.py.
"""

import unreal

U = 48.0
TAG = "OTTOQL"   # dusk light actors — cleared/rebuilt each run

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def W(x, y, z_cm=0.0):
    return unreal.Vector((x - 150.0) * U, (y - 110.0) * U, z_cm)


def find(prefix):
    return [a for a in eas.get_all_level_actors() if (a.get_actor_label() or "").startswith(prefix)]


def find_one(label):
    for a in eas.get_all_level_actors():
        if (a.get_actor_label() or "") == label:
            return a
    return None


def _set(obj, **kw):
    for k, v in kw.items():
        try:
            obj.set_editor_property(k, v)
        except Exception:
            pass


# --------------------------------------------------- clear prior dusk lights -
n = 0
for a in list(eas.get_all_level_actors()):
    try:
        if unreal.Name(TAG) in list(a.tags):
            eas.destroy_actor(a)
            n += 1
    except Exception:
        pass
unreal.log(f"[OTTOQ dusk] cleared {n} prior lights")

# ------------------------------------------------------ 1. sun = golden hour -
sun = find_one("OTTOQ_Sun")
if sun:
    # Rotator(ROLL, PITCH, YAW); low pitch → SkyAtmosphere renders the sunset.
    sun.set_actor_rotation(unreal.Rotator(0.0, -5.0, -62.0), False)
    lc = sun.light_component
    lc.set_intensity(6.0)
    _set(lc, atmosphere_sun_light=True, use_temperature=False)
    try:
        lc.set_light_color(unreal.Color(255, 166, 104))   # warm amber key
    except Exception:
        pass
    unreal.log("[OTTOQ dusk] sun -> low warm key")

# --------------------------------------------------- 2. skylight = dusk fill -
sky = find_one("OTTOQ_SkyLight")
if sky:
    sc = sky.light_component
    _set(sc, real_time_capture=True)
    try:
        sc.set_intensity(0.85)
    except Exception:
        pass
    try:
        sc.recapture_sky()
    except Exception:
        pass

# --------------------------------------------------- 3. fog = volumetric dusk -
fog = find_one("OTTOQ_Fog")
if fog:
    fc = fog.component
    _set(fc,
         fog_density=0.02,
         fog_height_falloff=0.12,
         start_distance=600.0,
         volumetric_fog=True,
         volumetric_fog_scattering_distribution=0.55,
         volumetric_fog_extinction_scale=1.0,
         volumetric_fog_albedo=unreal.Color(180, 175, 190),
         directional_inscattering_exponent=10.0,
         directional_inscattering_start_distance=4000.0)
    # color prop name varies across UE versions — try both
    for k in ("fog_inscattering_luminance", "fog_inscattering_color"):
        _set(fc, **{k: unreal.LinearColor(0.05, 0.06, 0.10, 1.0)})
    _set(fc, directional_inscattering_color=unreal.LinearColor(1.0, 0.45, 0.18, 1.0))
    unreal.log("[OTTOQ dusk] fog -> volumetric")

# ------------------------------------------- 4. post: expose for glow + grade -
ppv = find_one("OTTOQ_PPV")
if ppv:
    s = ppv.settings
    _set(s,
         override_bloom_intensity=True, bloom_intensity=0.7,
         override_auto_exposure_min_brightness=True, auto_exposure_min_brightness=0.55,
         override_auto_exposure_max_brightness=True, auto_exposure_max_brightness=1.7,
         override_auto_exposure_bias=True, auto_exposure_bias=-0.3,
         override_vignette_intensity=True, vignette_intensity=0.42,
         override_film_grain_intensity=True, film_grain_intensity=0.05,
         override_color_saturation=True)
    _set(s, color_saturation=unreal.Vector4(1.08, 1.08, 1.08, 1.0))
    # split-tone: cool shadows, warm highlights
    _set(s,
         override_color_gain_shadows=True,
         color_gain_shadows=unreal.Vector4(0.90, 0.97, 1.14, 1.0),
         override_color_gain_highlights=True,
         color_gain_highlights=unreal.Vector4(1.12, 1.02, 0.88, 1.0))
    ppv.set_editor_property("settings", s)
    unreal.log("[OTTOQ dusk] post -> dusk grade")

# --------------------------------------------------------- 5. real fixtures --
def spot(label, loc, rot, lumens, temp, inner, outer, radius, shadows=False):
    a = eas.spawn_actor_from_class(unreal.SpotLight, loc, rot)
    a.set_actor_label(label)
    a.tags = [unreal.Name(TAG)]
    c = a.light_component
    _set(c, intensity_units=unreal.LightUnits.LUMENS)
    try:
        c.set_intensity(lumens)
    except Exception:
        pass
    _set(c, use_temperature=True, temperature=float(temp),
         inner_cone_angle=inner, outer_cone_angle=outer,
         attenuation_radius=radius, cast_shadows=shadows,
         volumetric_scattering_intensity=1.0)
    return a


def point(label, loc, lumens, temp, radius, shadows=False):
    a = eas.spawn_actor_from_class(unreal.PointLight, loc, unreal.Rotator(0, 0, 0))
    a.set_actor_label(label)
    a.tags = [unreal.Name(TAG)]
    c = a.light_component
    _set(c, intensity_units=unreal.LightUnits.LUMENS)
    try:
        c.set_intensity(lumens)
    except Exception:
        pass
    _set(c, use_temperature=True, temperature=float(temp),
         attenuation_radius=radius, cast_shadows=shadows,
         volumetric_scattering_intensity=1.0)
    return a


# pole-head yard lights — warm-white downlights over the lot
heads = find("OTTOQ_PoleHead")
for i, h in enumerate(heads):
    p = h.get_actor_location()
    spot(f"OTTOQL_Pole_{i}", unreal.Vector(p.x, p.y, p.z + 30.0),
         unreal.Rotator(0, -90, 0), 60000.0, 4200.0, 32.0, 58.0, 7500.0)
unreal.log(f"[OTTOQ dusk] {len(heads)} pole lights")

# under-canopy charging wash — cool white along each ridge
CANOPIES = [("A", 103, 122), ("B", 150, 122), ("C", 197, 122)]
ci = 0
for cid, cx, cy in CANOPIES:
    for dy in (-28, 0, 28):
        point(f"OTTOQL_Canopy_{ci}", W(cx, cy + dy, 9.4 * U), 26000.0, 5200.0, 2700.0)
        ci += 1
unreal.log(f"[OTTOQ dusk] {ci} canopy lights")

# gate / guard security spots — cooler, angled across the entrances
for nm, gx in (("In", 100), ("Out", 200)):
    spot(f"OTTOQL_Gate_{nm}", W(gx, 203, 7.2 * U),
         unreal.Rotator(0, -62, 90), 30000.0, 5600.0, 34.0, 60.0, 4800.0)

# office spill — warm point inside the glass hub so light pours out the curtain wall
office = find_one("OTTOQ_LitInterior") or None
if office:
    p = office.get_actor_location()
    point("OTTOQL_Office", unreal.Vector(p.x, p.y, p.z + 60.0), 22000.0, 3500.0, 3200.0)

les.save_current_level()
unreal.log("[OTTOQ dusk] DONE — golden-hour pass applied")
