---
name: autoproj
description: 'Use when building, testing, linting, updating, or navigating packages in an autoproj workspace (Ruby-based multi-repo source/package manager built on autobuild); running amake/aup/autoproj/alocate/acd; sourcing env.sh, using autoproj exec, or preparing PYTHONPATH for Python tests; diagnosing build/test failures, locating a package srcdir/builddir/prefix/logdir, reading build_report.json, or understanding the manifest, package sets, .autoproj/config.yml, and installation-manifest.'
---

# Working in an Autoproj Workspace

Autoproj manages a workspace of many independently-versioned packages, each built
by **autobuild** (CMake, Autotools, Python, Ruby, Orogen, …). This skill explains
how to operate in such a workspace correctly.

## Detect that you are in an autoproj workspace

Look upward from the current directory for a root containing **both** `autoproj/`
(with a `manifest` file) and `.autoproj/` (with `config.yml`). That root is the
workspace root. `env.sh` / `env.bash` also live there.

Keep its absolute path as `root`. Workspace-relative paths below (such as
`.autoproj/installation-manifest`) are relative to `root`, not the package's
working directory. `srcdir` and `builddir` mean the selected package's resolved
absolute paths from that manifest. `<pkg>` means its full `name`, including any
namespace (not just the last path component).

## Mental model: generated vs. source

| Path | Role | Edit? |
|------|------|-------|
| `autoproj/` (`manifest`, `init.rb`, `overrides.rb`, `overrides.d/`) | Workspace config | Yes (carefully) |
| Package source dirs | Actual code | **Yes — edit here** |
| Build dir, install/prefix dir | autobuild output | **No — generated** |
| `.autoproj/` (`config.yml`, `remotes/`, `installation-manifest`) | autoproj state | **No — generated** |
| `env.sh`, `env.bash` | Environment scripts | **No — generated** |

Source, build, and prefix locations are **configurable** — never hardcode `src/`,
`build/`, or `install/`. See [config-files.md](./references/config-files.md).

## Rules that prevent most mistakes

1. **Resolve paths from `.autoproj/installation-manifest`**, not from guesses and
   not from `alocate` (which is known to be buggy). It is a YAML file with, per
   package: `name`, `type`, `vcs`, `srcdir`, `importdir`, `prefix`, `builddir`,
   `logdir`, `dependencies`. See [config-files.md](./references/config-files.md).
2. **Run package-scoped commands from the package's `srcdir`, never the workspace
   root.** This includes builds, tests, linters, and type-checkers. Set the tool's
   working directory explicitly or use `cd "$srcdir" && <cmd>` for each invocation;
   do not rely on a previous shell's directory. Change directory **before launching
   `autoproj exec`**, not inside a shell wrapped by it. Passing a package name or an
   absolute test path is **not** a substitute: linters and test discovery can scan
   the working directory and pick up unrelated packages or configuration. For
   multiple packages, run checks separately from each `srcdir`. Use the workspace
   root for workspace discovery and explicitly workspace-wide operations only.
3. **Run everything inside the workspace environment.** Either
   `source "$root/env.sh"` once per shell, or use the absolute workspace wrapper
   `"$root/.autoproj/bin/autoproj" exec -- <cmd>`. For a **package** command, use
   `cd "$srcdir" && "$root/.autoproj/bin/autoproj" exec -- <cmd>`.
   Absolute workspace paths keep environment setup valid after changing into
   `srcdir`. An `exec` invocation does not activate the environment for subsequent
   shell commands.
4. **Prepare Python imports before running tests.** Build/refresh with
   `amake <pkg>` (or just `amake` from `srcdir`), **or** prepend `srcdir` to the
   workspace environment's `PYTHONPATH` for a direct source test. Sourcing the
   environment alone does not ensure the package under test is importable or
   up to date. See [Python test prerequisites](#python-test-prerequisites).

## Common workflows

### Build a package (and its dependencies)
```bash
source "$root/env.sh" &&
cd "$srcdir" &&
amake --tool <pkg>          # build pkg + deps, stream real compiler output
```
`amake` = `autoproj build`. From `srcdir`, `amake` or `amake .` selects the current
package. Add `-n` to skip already-built dependencies, or `--rebuild` for a clean
rebuild. Keep the environment and directory setup for every variant.

### Update / import
```bash
cd "$srcdir" && "$root/.autoproj/bin/autoproj" exec -- aup <pkg>
```
`aup` = `autoproj update` (fetch + checkout + deps); add `--no-deps` to update only
the selected package.

### Test
```bash
# FIRST: show Enabled + Available status
cd "$srcdir" && "$root/.autoproj/bin/autoproj" exec -- autoproj test list <pkg>
# When enabled and available, run with real ctest/pytest output
cd "$srcdir" && "$root/.autoproj/bin/autoproj" exec -- autoproj test --tool <pkg>
```
**`autoproj test` silently does nothing** (exits 0, no output) when a package's
tests are **disabled** or **unavailable** — do not mistake that for "passed".
Check first with `autoproj test list <pkg>` (shows `Enabled` and `Available`):
- **Enabled = false** → turn tests on, rebuild so test targets exist, then run:
  ```bash
   source "$root/env.sh" &&
   cd "$srcdir" &&
   autoproj test enable <pkg> &&
   amake --tool <pkg> &&
   autoproj test --tool <pkg>
  ```
   Enabling persists in workspace config (revert: `autoproj test disable <pkg>`).
- **Available = false** (after enabling + building) → the package defines no
  runnable test suite; report that and stop, don't keep retrying.

### Python test prerequisites

From `srcdir`, either successfully run `amake <pkg>` (or `amake`) after source
changes **before** testing, or use a source-first `PYTHONPATH` for a focused direct
test without installing. For the latter, activate the workspace env **first**,
then prepend the package's resolved `srcdir`, preserving the existing value:

```bash
source "$root/env.sh" &&
cd "$srcdir" &&
PYTHONPATH="$srcdir${PYTHONPATH:+:$PYTHONPATH}" pytest <test-path>
```

The command-local assignment also works when `PYTHONPATH` is unset or empty,
without adding an empty path entry. **Keep the double quotes** so shell variables
expand; single quotes would create a literal, invalid search path. It does not
replace building missing dependencies or required generated artifacts, and does
**not** replace setting the working directory to `srcdir`.

### C++ test output

For C++ packages, `autoproj test` typically calls `make test`, which can swallow
per-test output. Keep the shell in `srcdir` and select the resolved **build dir**
with `-C`, via the env:
```bash
cd "$srcdir" &&
"$root/.autoproj/bin/autoproj" exec -- make -C "$builddir" test ARGS=-V
```

### Navigate
```bash
acd <pkg>                   # cd into a package's source dir (shell helper)
```
Prefer reading `srcdir` from the installation-manifest when you need a path
programmatically.

### Non-interactive automation
Pass `--no-interactive` (or export `AUTOPROJ_NONINTERACTIVE=1`) so configuration
questions never block.

## Health check when commands fail

Run `autoproj envsh` (reloads the workspace, regenerates `env.sh`). If it
**succeeds**, re-source `"$root/env.sh"` and retry. If it **fails**, the workspace is
broken: diagnose and *propose* a fix, but **request explicit user authorization
before any corrective action**. See [troubleshooting.md](./references/troubleshooting.md).

## Reference files

- [commands.md](./references/commands.md) — full CLI: subcommands, `amake`/`aup`/`alog`/`acd`, key flags (`--tool`, `-n`, `--rebuild`, `--force`, `--no-interactive`), `autoproj exec`, `autoproj which`, `autoproj envsh`.
- [package-types.md](./references/package-types.md) — autobuild package types, the build phases (import → prepare → build → install), and the concrete commands each type runs.
- [troubleshooting.md](./references/troubleshooting.md) — log locations, `build_report.json`, rebuild recipes, the `envsh` health-check ladder, and how to locate and read the autoproj/autobuild source for authoritative answers.
- [config-files.md](./references/config-files.md) — `manifest`, package sets / `source.yml`, `init.rb`, `overrides.rb`, `.autoproj/config.yml`, and the `installation-manifest` schema.
