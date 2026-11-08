#!/usr/bin/env python3
"""Build the OTTOYARD robot CAD: every robot's STEP (zipped), GLB, bill of materials (JSON and CSV), and
public/cad/manifest.json, which the twin's Robotics tab reads.

    python3 -m venv cad/.venv && cad/.venv/bin/pip install -r cad/requirements.txt
    cad/.venv/bin/python cad/build.py               # all robots
    cad/.venv/bin/python cad/build.py charge_arm    # one

The dimensions come from cad/spec/robots.json, the twin's own robot specs (src/lib/robotics/cadSpec.ts).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from otto_cad.core import write_json  # noqa: E402
from otto_cad.glb import write_glb    # noqa: E402

OUT = os.path.join(HERE, '..', 'public', 'cad')
ROBOTS = ['charge_arm', 'clean_arm', 'wash_gantry']


def step_check(path: str) -> dict:
    """Re-import a written STEP: every placed part must come back as a named node, and every solid must be valid."""
    import cadquery as cq
    from OCP.BRepCheck import BRepCheck_Analyzer
    a = cq.Assembly.importStep(path)
    out = {'namedParts': 0, 'solids': 0, 'invalid': 0}

    def walk(x):
        for ch in x.children:
            walk(ch)
        if x.obj is not None and not x.children:
            out['namedParts'] += 1
            for sld in x.obj.Solids():
                out['solids'] += 1
                if not BRepCheck_Analyzer(sld.wrapped).IsValid():
                    out['invalid'] += 1
    walk(a)
    return out


def build_one(key: str, spec: dict) -> dict:
    mod = __import__(f'otto_cad.robots.{key}', fromlist=['build'])
    t0 = time.time()
    model = mod.build(spec)
    t_model = time.time() - t0
    bom = model.bom()
    os.makedirs(OUT, exist_ok=True)
    glb_path = os.path.join(OUT, f'{key}.glb')
    gx = {'specVersion': spec['version']}
    if model.flexes:   # each line solved at a few poses, for the viewer's test to solve the same and compare
        from otto_cad.flex import samples
        pp = json.load(open(os.path.join(HERE, 'spec', 'poses.json')))['robots'].get(key, []) if os.path.exists(
            os.path.join(HERE, 'spec', 'poses.json')) else []
        gx['flexCheck'] = samples(model.flexes, model.root, [{'id': 'stowed', 'angles': {}}] + pp[:4])
    stats = write_glb(model, glb_path, gx)
    step_tmp = os.path.join(HERE, f'.{key}.step')
    model.to_step(step_tmp)
    zpath = os.path.join(OUT, f'{key}.step.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        info = zipfile.ZipInfo(f'{key}.step', date_time=(2026, 1, 1, 0, 0, 0))   # fixed date: stable zips
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(step_tmp, 'rb') as f:
            z.writestr(info, f.read())
    step_bytes = os.path.getsize(step_tmp)
    chk = step_check(step_tmp)
    os.remove(step_tmp)
    # the depot model: what the yard draws (last: it re-meshes the shapes coarsely)
    depot_path = os.path.join(OUT, f'{key}.depot.glb')
    dstats = write_glb(model, depot_path, {'specVersion': spec['version'], 'lod': 'depot'}, depot=True)   # carries the lines too
    with open(depot_path, 'rb') as f:
        depot_digest = hashlib.sha256(f.read()).hexdigest()[:16]
    placed = sum(l['qty'] for l in bom['lines'])
    if chk['invalid'] or chk['namedParts'] != placed:
        raise SystemExit(f'{key}: STEP check failed: {chk} against {placed} placed parts')
    write_json(os.path.join(OUT, f'{key}.bom.json'), bom)
    with open(os.path.join(OUT, f'{key}.bom.csv'), 'w', newline='') as f:
        f.write(model.bom_csv())
    with open(glb_path, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:16]
    print(f'{key}: {bom["totals"]["parts"]} parts ({bom["totals"]["uniqueParts"]} unique, '
          f'{bom["totals"]["fasteners"]} fasteners), {bom["totals"]["massKg"]} kg; '
          f'GLB {stats["bytes"] / 1e6:.2f} MB, {stats["triangles"]} tris; STEP {step_bytes / 1e6:.1f} MB '
          f'({os.path.getsize(zpath) / 1e6:.2f} MB zipped, re-imported: {chk["namedParts"]} parts, {chk["solids"]} solids, '
          f'{chk["invalid"]} invalid); depot GLB {dstats["bytes"] / 1e6:.2f} MB, {dstats["triangles"]} tris; '
          f'{time.time() - t0:.0f} s (model {t_model:.0f} s)')
    return {
        'key': key, 'title': model.title, 'frame': model.frame,
        'files': {'glb': f'{key}.glb', 'step': f'{key}.step.zip', 'bom': f'{key}.bom.json', 'csv': f'{key}.bom.csv',
                  'depot': f'{key}.depot.glb'},
        'bytes': {'glb': stats['bytes'], 'stepZip': os.path.getsize(zpath), 'step': step_bytes, 'depot': dstats['bytes']},
        'mesh': {k: stats[k] for k in ('vertices', 'triangles', 'meshes', 'nodes')},
        'depotMesh': {k: dstats[k] for k in ('vertices', 'triangles', 'meshes', 'nodes')}, 'depotSha256': depot_digest,
        'totals': bom['totals'], 'glbSha256': digest, 'stepCheck': chk,
        'subsystems': [{'id': s['id'], 'name': s['name']} for s in bom['subsystems']],
    }


def main() -> None:
    spec = json.load(open(os.path.join(HERE, 'spec', 'robots.json')))
    want = sys.argv[1:] or ROBOTS
    man_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {'robots': []}
    by_key = {r['key']: r for r in manifest.get('robots', [])}
    for key in want:
        by_key[key] = build_one(key, spec)
    manifest = {
        'generator': 'cad/build.py (CadQuery 2.8, OpenCascade 7.9)',
        'specVersion': spec['version'],
        'units': {'cad': 'mm', 'glb': 'm'},
        'robots': [by_key[k] for k in ROBOTS if k in by_key],
    }
    write_json(man_path, manifest)


if __name__ == '__main__':
    main()
