#!/usr/bin/env python3
import zipfile
import os, subprocess, json
from pathlib import Path

library_zip_fn_pre = 'test_dist/'

os.chdir('combined_lib')
subprocess.call(['lean', '-v'])
subprocess.call(['leanpkg', 'build'])
lean_p = json.loads(subprocess.check_output(['lean', '-p']))
lean_path = [Path(p).resolve() for p in lean_p["path"]]

already_seen = set()
filenames = set()
for p in lean_path:
    p_seen = 0
    psplit = str(p).split('/')
    pkgname = psplit.pop()
    if pkgname == 'src':
        pkgname = psplit.pop()
    zipfn = '../' + library_zip_fn_pre + pkgname + '.zip'
    i = 0
    while zipfn in filenames:
        zipfn = '../' + library_zip_fn_pre + pkgname + '_' + str(i) + '.zip'
        i += 1
    filenames.add(zipfn)
    with zipfile.ZipFile(zipfn, mode='w', compression=zipfile.ZIP_DEFLATED, allowZip64=False, compresslevel=9) as zf:
        for fn in p.glob('**/*.olean'):
            rel = fn.relative_to(p)
            if '_target' in rel.parts:
                continue
            elif rel in already_seen:
                print('duplicate: {0}'.format(fn))
            else:
                zf.write(fn, arcname=str(rel))
                already_seen.add(rel)
                p_seen += 1
    if p_seen == 0:
        os.remove(zipfn)
    else:
        print('Created {0} from {1} with {2} olean files, {3} files total so far'.format(zipfn[3:], str(p), p_seen, len(already_seen)))
