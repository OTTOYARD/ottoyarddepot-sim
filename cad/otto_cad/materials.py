"""Materials: density for the bill of materials' masses, and the look for STEP colours and the GLB.

Densities are handbook values (kg/m3), nominal, at room temperature. Colours are sRGB; the GLB
writer converts them to linear. The robot palette follows the twin's (buildCobot.COBOT_COLORS):
aluminium #d8dade, dark aluminium #9aa0a8, charcoal #1c1f24, OTTOYARD red #c8102e, status teal.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    key: str
    name: str           # what the bill of materials says
    density: float      # kg/m3
    color: str          # sRGB hex
    metal: float        # PBR metalness 0..1
    rough: float        # PBR roughness 0..1
    emissive: str | None = None
    opacity: float = 1.0


_M = [
    Material('al6061', 'Aluminium 6061-T6, machined, clear anodised', 2700, '#d8dade', 0.92, 0.28),
    Material('al6061_blk', 'Aluminium 6061-T6, machined, black anodised', 2700, '#2a2d33', 0.75, 0.38),
    Material('a356', 'Aluminium A356-T6 casting, powder-coated', 2680, '#d3d6da', 0.55, 0.42),
    Material('a356_dark', 'Aluminium A356-T6 casting, charcoal powder coat', 2680, '#1c1f24', 0.5, 0.48),
    Material('al_extr', 'Aluminium 6063-T6 extrusion, anodised', 2700, '#c4c8cd', 0.9, 0.32),
    Material('steel', 'Steel 42CrMo4, quenched and tempered', 7850, '#6d7279', 0.9, 0.35),
    Material('steel_s355', 'Structural steel S355, hot-dip galvanised', 7850, '#a3a9ae', 0.75, 0.55),
    Material('steel_paint', 'Structural steel S355, painted RAL 9005', 7850, '#16181b', 0.4, 0.55),
    Material('steel_yellow', 'Structural steel S355, painted safety yellow', 7850, '#e8b10f', 0.35, 0.5),
    Material('bearing', 'Bearing steel 100Cr6, hardened', 7810, '#9097a0', 0.95, 0.18),
    Material('ss304', 'Stainless steel 1.4301 (304)', 7930, '#b9bec4', 0.9, 0.25),
    Material('ss316', 'Stainless steel 1.4401 (316)', 7980, '#b4b9bf', 0.9, 0.24),
    Material('fast_blk', 'Alloy steel, black oxide', 7850, '#26282c', 0.75, 0.42),
    Material('fast_zn', 'Steel, zinc flake coated', 7850, '#9da3a8', 0.85, 0.38),
    Material('fast_a2', 'Stainless steel A2-70', 7930, '#c3c7cc', 0.9, 0.26),
    Material('fast_a4', 'Stainless steel A4-80', 7980, '#c0c4c9', 0.9, 0.25),
    Material('copper', 'Copper winding, enamelled', 8960, '#b8693a', 0.85, 0.35),
    Material('magnet', 'NdFeB magnet, nickel plated', 7500, '#7c8189', 0.9, 0.3),
    Material('lam', 'Electrical steel laminations M270-35A', 7650, '#4b5057', 0.8, 0.45),
    Material('rubber', 'EPDM rubber', 1150, '#141517', 0.05, 0.85),
    Material('nbr', 'NBR seal elastomer', 1250, '#0f1012', 0.05, 0.8),
    Material('pu', 'Polyurethane, 90 Shore A', 1200, '#262a30', 0.05, 0.7),
    Material('pa66', 'PA66-GF30', 1350, '#202226', 0.1, 0.6),
    Material('pom', 'POM-C (acetal)', 1410, '#e9e8e2', 0.05, 0.45),
    Material('pc', 'Polycarbonate, clear', 1200, '#9fb4c2', 0.1, 0.08, None, 0.55),
    Material('lens', 'Optical glass, coated', 2500, '#0b1418', 0.2, 0.06),
    Material('cable', 'Cable, TPE jacket', 1500, '#14161a', 0.05, 0.75),
    Material('hose', 'Hose, PVC with steel helix', 1300, '#2b3036', 0.05, 0.6),
    Material('accent', 'Aluminium, OTTOYARD red powder coat', 2700, '#c8102e', 0.35, 0.45),
    Material('led', 'LED module, PC diffuser', 1200, '#00e5ff', 0.1, 0.35, '#00e5ff'),
    Material('led_red', 'LED module, red', 1200, '#ff2d2d', 0.1, 0.35, '#ff2020'),
    Material('led_green', 'LED module, green', 1200, '#2dff6a', 0.1, 0.35, '#20ff60'),
    Material('led_amber', 'LED module, amber', 1200, '#ffb020', 0.1, 0.35, '#ffa010'),
    Material('pcb', 'FR-4 circuit board', 1850, '#1f5a3a', 0.2, 0.5),
    Material('pad_white', 'Microfibre on open-cell foam, white', 120, '#f2f4f7', 0.0, 0.95),
    Material('concrete', 'Concrete C30/37', 2400, '#8f8d88', 0.0, 0.9),
    Material('brass', 'Brass CW614N', 8500, '#c9a94a', 0.9, 0.3),
    Material('silver', 'Copper alloy, silver plated', 8900, '#d9d9d6', 0.95, 0.2),
    Material('ptfe', 'PTFE', 2200, '#f1f1ee', 0.0, 0.5),
    Material('carbon', 'Carbon fibre tube, filament wound', 1550, '#1a1b1e', 0.3, 0.35),
]

MATERIALS: dict[str, Material] = {m.key: m for m in _M}


def material(key: str) -> Material:
    try:
        return MATERIALS[key]
    except KeyError as e:  # a typo should fail the build, not paint a part grey
        raise KeyError(f'unknown material {key!r}') from e
