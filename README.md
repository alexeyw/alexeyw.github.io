# alexeyw.github.io

Personal site of Aleksei Volodin: a resume and portfolio written as a case file kept by his AI agent.
English at the root, Spanish at `/es/`, Russian at `/ru/`, and a plain CV at `Aleksei_Volodin_CV.pdf`.

The pages are generated. Edit `_src/content.py`, `_src/site.css` or `_src/site.js`, then run
`python3 _src/build.py`. The build checks every cited source and refreshes the figures the page calls
verified (GitHub API through `gh`, the Google Play listing). It stops if a source no longer answers.

Single skills are marked the same way: `SKILL_PROOF` in `_src/content.py` names a pattern for each one, and the
build looks for it in Knotwork's public version catalog. A skill whose pattern is no longer found goes back to
"his word" by itself.

`python3 _src/recheck.py` runs the build, compares the fresh figures with the ones this repository was built
from, and opens a pull request when a figure moved or the published check is three weeks old. Nothing is
merged without a person; `--dry-run` stops before the push.

Colored Seeds has its own repository, `alexeyw/colored-seeds`, and is served at
https://alexeyw.github.io/colored-seeds/.

This repository also holds the Google Search Console verification file for the whole domain. Do not
delete the `google*.html` file: Google re-checks it, and the Google Cloud OAuth branding of Colored
Seeds depends on this domain staying verified.
