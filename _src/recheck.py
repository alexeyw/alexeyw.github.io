#!/usr/bin/env python3
"""Re-check the dossier's public sources and, if anything moved, open a pull request with the rebuilt site.

Usage:  python3 dossier/_src/recheck.py [--dry-run]

1. Runs build.py, which asks every cited source again and stops if one is gone.
2. Compares the fresh figures with the ones the public repository was built from.
3. If a figure changed, or the published check is older than STALE_DAYS, copies the rebuilt site into a
   fresh clone on its own branch, commits, pushes and opens a pull request. Merging stays a person's decision.

Exit codes: 0 nothing to do or pull request opened, 2 a source is gone or the build failed, 3 git or gh failed.
--dry-run does everything except push and open the pull request, and says what it would have sent.
"""
import argparse
import datetime as dt
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

SRC = pathlib.Path(__file__).resolve().parent
ROOT = SRC.parent
REPO = 'alexeyw/alexeyw.github.io'
STALE_DAYS = 21  # a month-old check marks itself on the page; the refresh comes before that
SITE_FILES = ['index.html', 'es/index.html', 'ru/index.html', 'Aleksei_Volodin_CV.pdf', '.nojekyll',
              'assets/site.css', 'assets/site.js', 'assets/favicon.svg', 'assets/og.png',
              '_src/build.py', '_src/content.py', '_src/recheck.py', '_src/site.css', '_src/site.js', '_src/facts.json']


def run(*cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, text=True, capture_output=True).stdout.strip()


def changes(old, new):
    """What moved between two sets of figures, one line per figure."""
    out = []
    for key in sorted(set(old) | set(new)):
        a, b = old.get(key), new.get(key)
        if a == b:
            continue
        if isinstance(a, list) or isinstance(b, list):
            gone, came = sorted(set(a or []) - set(b or [])), sorted(set(b or []) - set(a or []))
            out.append(f'{key}: ' + '; '.join(x for x in ('no longer found: ' + ', '.join(gone) if gone else '', 'now found: ' + ', '.join(came) if came else '') if x))
        else:
            out.append(f'{key}: {a} → {b}')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    built = subprocess.run([sys.executable, str(SRC / 'build.py')], text=True, capture_output=True)
    if built.returncode != 0:
        print(built.stdout[-2000:], built.stderr[-2000:], sep='\n')
        print('The build stopped, so nothing is published. A cited source may be gone: read the lines above.')
        return 2
    fresh = json.loads((SRC / 'facts.json').read_text())

    with tempfile.TemporaryDirectory() as tmp:
        clone = pathlib.Path(tmp) / 'site'
        try:
            run('gh', 'repo', 'clone', REPO, str(clone), '--', '-q', '--depth', '1')
            published = json.loads((clone / '_src' / 'facts.json').read_text())
            moved = changes(published['facts'], fresh['facts'])
            age = (dt.date.fromisoformat(fresh['checked']) - dt.date.fromisoformat(published['checked'])).days
            if not moved and age < STALE_DAYS:
                print(f'Nothing moved, and the published check is {age} days old. No pull request.')
                return 0

            branch = f'recheck-{fresh["checked"]}'
            run('git', 'switch', '-q', '-c', branch, cwd=clone)
            for rel in SITE_FILES:
                target = clone / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / rel, target)
            title = f'Re-check the public sources, {fresh["checked"]}'
            lines = moved or [f'No figure moved. The published check was {age} days old.']
            body = ('Every cited source answered on ' + fresh['checked'] + '. Compared with the figures the site was built from on '
                    + published['checked'] + ':\n\n' + '\n'.join(f'- {x}' for x in lines)
                    + '\n\nThe pages, the CV PDF and the social preview are rebuilt from the same run of `_src/build.py`.\n')
            print(title, body, sep='\n\n')
            if a.dry_run:
                print(run('git', 'status', '--short', cwd=clone))
                print('Dry run: nothing committed, pushed or opened.')
                return 0
            # A public repository gets the account's no-reply address, never the machine's own git identity.
            who = json.loads(run('gh', 'api', 'user'))
            run('git', 'config', 'user.name', who['login'], cwd=clone)
            run('git', 'config', 'user.email', f'{who["id"]}+{who["login"]}@users.noreply.github.com', cwd=clone)
            run('git', 'add', '-A', cwd=clone)
            run('git', 'commit', '-q', '-m', title, '-m', body, cwd=clone)
            run('git', 'push', '-q', '-u', 'origin', branch, cwd=clone)
            print(run('gh', 'pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body, cwd=clone))
            return 0
        except subprocess.CalledProcessError as e:
            print(e.stdout, e.stderr, sep='\n')
            return 3


if __name__ == '__main__':
    sys.exit(main())
