---
description: "Run an autoproj package's tests and any project-configured linters/type-checkers, with full output."
argument-hint: '<package-name> (optional; defaults to the current package)'
agent: agent
---
Run the checks for the autoproj package: **${input:package:leave empty for the current package}**.

Follow the `autoproj` skill. Work inside the workspace environment. Resolve paths
from the workspace's `.autoproj/installation-manifest`. In commands below, `root`
is the absolute workspace root; `srcdir` and `builddir` are the package's resolved
paths. Source `"$root/env.sh"` or wrap commands with
`"$root/.autoproj/bin/autoproj" exec -- <cmd>` so environment setup works from
`srcdir`.

Steps:
1. Identify the package and read its `type`, `srcdir`, `builddir`, `logdir` from
   the installation-manifest. **Set every package command's working directory to
   `srcdir`, not the workspace root** (or use `cd "$srcdir" && <cmd>`). A package
   argument or absolute test path is not a substitute. Change directory **before**
   launching `autoproj exec`, not in its child shell. Ensure required build
   artifacts exist (`amake --tool <pkg>` if needed).
2. **Prepare Python imports before tests:** run `amake <pkg>` (or just `amake`
   from `srcdir`) to refresh the package, **or**, for a focused direct test without
   installing, first source `"$root/env.sh"`, then run from `srcdir` with
   `PYTHONPATH="$srcdir${PYTHONPATH:+:$PYTHONPATH}" pytest <test-path>`. Preserve
   the double quotes for variable expansion and the workspace's existing
   `PYTHONPATH`; environment activation alone may expose
   an absent or stale installed copy. Follow the skill's Python test prerequisites.
   If a focused direct test was requested, report its result instead of also
   running the full suite in step 3; the command-local `PYTHONPATH` does not carry
   over to another command.
3. **Run the test suite with real output:** first `autoproj test list <pkg>` to
   confirm tests are enabled — `autoproj test` gives **no output and exits 0** when
   they are disabled or unavailable (that is "not run", not "passed"). If disabled,
   `autoproj test enable <pkg>` (persists; note it) → `amake --tool <pkg>` → then
   run `autoproj test --tool <pkg>`. If `Available` stays false, report there is no
   test suite.
   - C++ fallback for hidden output: keep the shell in `srcdir` and select the
     build dir with `"$root/.autoproj/bin/autoproj" exec -- make -C "$builddir" test ARGS=-V`.
4. **Run only the linters/type-checkers the package itself configures** — detect
   them from config files in the package (e.g. `.clang-format`/`.clang-tidy` for
   C++; `setup.cfg`/`pyproject.toml`/`.flake8`/`mypy.ini`/`.ruff.toml`/
   `pyrightconfig.json` for Python). Invoke each **with `srcdir` as cwd**, inside
   the env (`"$root/.autoproj/bin/autoproj" exec -- <linter> …`). Never lint from
   the workspace root: tools may scan `.` or discover unrelated configuration
   even when given a package path. Do **not** introduce new tools or rule sets
   that the project hasn't adopted.
5. Use `--no-interactive`.

Report the package `srcdir`, each check run, pass/fail, and the exact output for
any failure. If the workspace itself misbehaves, run `autoproj envsh` and report —
request authorization before any corrective action.
