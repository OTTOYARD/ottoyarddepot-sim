#!/usr/bin/env python3
"""Clash and contact check of the robot CAD at the twin's poses (otto_cad/check.py says what is checked).

    cad/.venv/bin/python cad/clash.py                # all robots, every pose in cad/spec/poses.json
    cad/.venv/bin/python cad/clash.py clean_arm      # one
    cad/.venv/bin/python cad/clash.py --stowed       # the stowed pose only (quick, prints, writes nothing)
    cad/.venv/bin/python cad/clash.py --baseline     # and lower cad/clash_baseline.json to what it finds

Run it after build.py: it builds the same model again, checks it, and writes public/cad/<robot>.clash.json with the
GLB digest it checked (manifest.json's glbSha256). cad.test.ts fails if a report does not match its GLB, or if it finds
more clashes or floating parts than cad/clash_baseline.json allows; the baseline only ever goes down.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from otto_cad.check import check      # noqa: E402
from otto_cad.core import write_json  # noqa: E402

OUT = os.path.join(HERE, '..', 'public', 'cad')
ROBOTS = ['charge_arm', 'clean_arm', 'wash_gantry']


def poses_for(key: str) -> list[dict]:
    path = os.path.join(HERE, 'spec', 'poses.json')
    if not os.path.exists(path):
        return []
    return json.load(open(path))['robots'].get(key, [])


def run(key: str, spec: dict, stowed_only: bool = False, model=None) -> dict:
    if model is None:
        mod = __import__(f'otto_cad.robots.{key}', fromlist=['build'])
        model = mod.build(spec)
    rep = check(model, [] if stowed_only else poses_for(key))
    man = os.path.join(OUT, 'manifest.json')
    if os.path.exists(man):
        entry = next((r for r in json.load(open(man))['robots'] if r['key'] == key), None)
        rep['glbSha256'] = entry and entry.get('glbSha256')
    return rep


def summary(rep: dict) -> str:
    c = rep['counts']
    return (f"{rep['robot']}: {len(rep['poses'])} poses, {rep['pairsChecked']} pairs measured, {c['clash']} clashes, "
            f"{len(rep['floating'])} floating groups; expected overlaps: {c['thread']} thread, {c['seal']} seal, "
            f"{c['ring']} ring, {c['context']} context; {rep['seconds']} s")


def main(argv: list[str]) -> None:
    stowed_only = '--stowed' in argv
    keys = [a for a in argv if not a.startswith('--')] or ROBOTS
    spec = json.load(open(os.path.join(HERE, 'spec', 'robots.json')))
    for key in keys:
        rep = run(key, spec, stowed_only)
        print(summary(rep))
        for r in rep['clashes'][:60]:
            print(f"   CLASH {r['volumeMm3']:>10.1f} mm3  {r['a']['item']} ({r['a']['sub']}) x {r['b']['item']} ({r['b']['sub']})"
                  f"  at {r['at']}  poses {','.join(r['poses'][:4])}{'...' if len(r['poses']) > 4 else ''}")
        for g in rep['floating'][:30]:
            print(f"   FLOATING group of {len(g)}: " + ', '.join(f"{d['item']} ({d['sub']})" for d in g[:6]))
        dump = next((a.split('=', 1)[1] for a in argv if a.startswith('--dump=')), None)
        if dump:
            write_json(os.path.join(dump, f'{key}.clash.json'), rep)
        elif not stowed_only:
            write_json(os.path.join(OUT, f'{key}.clash.json'), rep)
            if '--baseline' in argv:
                bpath = os.path.join(HERE, 'clash_baseline.json')
                base = json.load(open(bpath)) if os.path.exists(bpath) else {}
                old = base.get(key, {'clashes': 10 ** 6, 'floatingGroups': 10 ** 6})
                base[key] = {'clashes': min(old['clashes'], len(rep['clashes'])),
                             'floatingGroups': min(old['floatingGroups'], len(rep['floating']))}
                write_json(bpath, base)


if __name__ == '__main__':
    main(sys.argv[1:])
