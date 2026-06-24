---
description: 'Diagnose a failing autoproj build or test: get real output, read logs and build_report.json, find the root cause, and propose a fix.'
argument-hint: '<package-name> (the package that is failing)'
agent: agent
---
Triage the failing autoproj package: **${input:package:failing package name}**.

Follow the `autoproj` skill's troubleshooting reference. Work inside the workspace
environment. Resolve all paths from `.autoproj/installation-manifest`.

Steps:
1. **Reproduce with real output** so the underlying error is visible:
   - Build: `amake --tool <pkg>`.
   - Test: `autoproj test --tool <pkg>` (C++ fallback from the build dir:
     `.autoproj/bin/autoproj exec -- make test ARGS=-V`).
2. **Read the logs.** From the package's `logdir`, inspect the relevant
   `<pkg>-<phase>.log` (import/prepare/build/install/test). Also check
   `build_report.json` (and `import_report.json`) under the install dir's `log/`.
3. **Pinpoint the root cause** — the first real error (failed compile/link,
   missing dependency, configure error, failing assertion). Distinguish a *source*
   problem (fix in `srcdir`) from an *environment/workspace* problem.
4. **Check workspace health** if it looks environmental: run `autoproj envsh`.
   - If it succeeds, re-source `env.sh` and retry.
   - If it fails, the workspace is broken: report findings and **propose** a fix
     (e.g. `reconfigure`, `osdeps`, rebuilding a dependency) but **request explicit
     user authorization before running any corrective action.**
5. **Propose the fix.** For a source/build issue, make the minimal edit in the
   package source (never in generated dirs) and re-verify with
   `amake --rebuild --tool <pkg>`.

Report: the exact failing output, the identified root cause, the fix applied or
proposed, and the verification result. Use `--no-interactive`.
