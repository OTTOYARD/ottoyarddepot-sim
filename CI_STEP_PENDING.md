# Deferred: one CI step, blocked on a token permission

`npm run layout:verify` is NOT yet wired into CI. Everything it runs is in this
branch and works locally — only the 12-line addition to
`.github/workflows/verify.yml` is missing.

## Why it is missing
Pushing a change to any file under `.github/workflows/` requires a GitHub token
with `workflow` scope. The token on this machine does not have it, so the push
was rejected. The change was NOT dropped — it is preserved on the local git tag
`layout-ci-step-pending`.

## Why it matters
An audit drew the database's depot for the first time and found 54 overlapping
stall pairs, 13 staging stalls inside the wash building, and 20 charging stalls
with no drivable aisle. None of it was caught, because nothing checked. This CI
step is what makes that unable to come back:

  - rebuilds the seed and diffs it — the generator is deterministic, so any diff
    means the committed seed is stale or the generator stopped being reproducible
  - runs the geometry guard, naming any offending stall by ID

## To land it
Grant `workflow` scope to the GitHub token, then:

    git push origin layout-ci-step-pending:refs/heads/layout-ci-step

and open that as a small follow-up PR. Or add these 12 lines to
`.github/workflows/verify.yml` directly in the GitHub web editor, after the
"Test" step and before "Build":

      - name: Layout seed is current and geometry is sound
        run: npm run layout:verify
