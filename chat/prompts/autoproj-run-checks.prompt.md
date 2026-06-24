---
description: "Run an autoproj package's tests and any project-configured linters/type-checkers, with full output."
argument-hint: '<package-name> (optional; defaults to the current package)'
agent: agent
---
Run the checks for the autoproj package: **${input:package:leave empty for the current package}**.

Follow the `autoproj` skill. Work inside the workspace environment. Resolve paths
from `.autoproj/installation-manifest`.

Steps:
1. Identify the package and read its `type`, `srcdir`, `builddir`, `logdir` from
   the installation-manifest. Ensure it is built (`amake --tool <pkg>` if needed).
2. **Run the test suite with real output:** first `autoproj test list <pkg>` to
   confirm tests are enabled — `autoproj test` gives **no output and exits 0** when
   they are disabled or unavailable (that is "not run", not "passed"). If disabled,
   `autoproj test enable <pkg>` (persists; note it) → `amake --tool <pkg>` → then
   run `autoproj test --tool <pkg>`. If `Available` stays false, report there is no
   test suite.
   - C++ fallback for hidden output: from the build dir,
     `.autoproj/bin/autoproj exec -- make test ARGS=-V`.
3. **Run only the linters/type-checkers the package itself configures** — detect
   them from config files in the package (e.g. `.clang-format`/`.clang-tidy` for
   C++; `setup.cfg`/`pyproject.toml`/`.flake8`/`mypy.ini`/`.ruff.toml`/
   `pyrightconfig.json` for Python). Invoke each inside the env
   (`.autoproj/bin/autoproj exec -- <linter> …`). Do **not** introduce new tools
   or rule sets that the project hasn't adopted.
4. Use `--no-interactive`.

Report each check run, pass/fail, and the exact output for any failure. If the
workspace itself misbehaves, run `autoproj envsh` and report — request
authorization before any corrective action.
