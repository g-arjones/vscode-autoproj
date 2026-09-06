---
description: 'Build and test a single autoproj package, showing real build/test output and reporting results.'
argument-hint: '<package-name> (optional; defaults to the package owning the current file/dir)'
agent: agent
---
Build and test the autoproj package: **${input:package:leave empty to use the current package}**.

Follow the `autoproj` skill. Work inside the workspace environment
(`source "$root/env.sh"` or `"$root/.autoproj/bin/autoproj" exec -- …`, where
`root` is the absolute workspace root). Resolve paths from the workspace's
`.autoproj/installation-manifest`, not `alocate`; `srcdir` and `builddir` below
are the target package's resolved paths.

Steps:
1. Identify the target package (the argument, or the package owning the current
   directory). Read its `type`, `srcdir`, `builddir`, and `logdir` from
   `.autoproj/installation-manifest`. **Set every package command's working
   directory to `srcdir`, not the workspace root** (or use `cd "$srcdir" && <cmd>`).
2. Build it with real output:
   - `amake --tool <pkg>` (use `-n`/`--no-deps` only if dependencies are already
     built; use `--rebuild` if a clean build is requested).
   - For Python, this refreshes the package before testing; workspace environment
     activation alone does not ensure current sources are importable.
3. If the build fails, read `<logdir>/<pkg>-build.log` and report the root cause
   before going further. Do not edit generated build/install files.
4. **Check test enablement before running:** `autoproj test list <pkg>` (shows
   `Enabled` / `Available`). `autoproj test` produces **no output and exits 0**
   when tests are disabled or unavailable — treat that as "not run", never "passed".
   - **Disabled** → enable, rebuild so test targets exist, then run:
     `autoproj test enable <pkg>` → `amake --tool <pkg>` → `autoproj test --tool <pkg>`.
     Enabling persists in workspace config; note it in your report (revert with
     `autoproj test disable <pkg>`).
   - **Available = false** after enabling + building → the package has no runnable
     test suite; report that and stop.
5. Run tests with real output:
   - `autoproj test --tool <pkg>`.
   - For a C++ package whose `make test` hides per-test output, fall back to
     `"$root/.autoproj/bin/autoproj" exec -- make -C "$builddir" test ARGS=-V`,
     keeping the shell in `srcdir`.
6. Use `--no-interactive` so nothing blocks.

Report: package name, type, and `srcdir`, build result, test result (pass/fail
counts if available), and the exact failing output for anything that failed. If commands
fail at the workspace level, run `autoproj envsh` as a health check and report —
do **not** take corrective action without explicit authorization.
