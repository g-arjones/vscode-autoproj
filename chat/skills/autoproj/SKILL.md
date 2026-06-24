---
name: autoproj
description: 'Work in an autoproj workspace (Ruby-based multi-repo source/package manager built on autobuild). Use when building, testing, updating, or navigating packages; when running amake/aup/autoproj/alocate/acd; when sourcing env.sh or using autoproj exec; when diagnosing build/test failures, locating a package srcdir/builddir/prefix/logdir, reading build_report.json, or understanding the manifest, package sets, .autoproj/config.yml, and installation-manifest.'
---

# Working in an Autoproj Workspace

Autoproj manages a workspace of many independently-versioned packages, each built
by **autobuild** (CMake, Autotools, Python, Ruby, Orogen, …). This skill explains
how to operate in such a workspace correctly.

## Detect that you are in an autoproj workspace

Look upward from the current directory for a root containing **both** `autoproj/`
(with a `manifest` file) and `.autoproj/` (with `config.yml`). That root is the
workspace root. `env.sh` / `env.bash` also live there.

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

## The two rules that prevent most mistakes

1. **Run everything inside the workspace environment.** Either `source env.sh`
   once per shell, or prefix each command with `.autoproj/bin/autoproj exec -- <cmd>`.
   Without this, the package's libraries, dependencies, and tools are not on the
   path and builds/tests/imports behave incorrectly.
2. **Resolve paths from `.autoproj/installation-manifest`**, not from guesses and
   not from `alocate` (which is known to be buggy). It is a YAML file with, per
   package: `name`, `type`, `vcs`, `srcdir`, `importdir`, `prefix`, `builddir`,
   `logdir`, `dependencies`. See [config-files.md](./references/config-files.md).

## Common workflows

### Build a package (and its dependencies)
```bash
amake <pkg>                 # build pkg + deps (amake = autoproj build)
amake -n <pkg>              # build ONLY pkg (deps must already be built)
amake --tool <pkg>          # stream real make/compiler output to STDOUT
amake --rebuild <pkg>       # clean + rebuild from scratch
amake .                     # build the package owning the current directory
```

### Update / import
```bash
aup <pkg>                   # aup = autoproj update (fetch + checkout + deps)
aup --no-deps <pkg>         # update only pkg
```

### Test
```bash
autoproj test list <pkg>        # FIRST: show Enabled + Available status
autoproj test <pkg>             # run the package's test suite (if enabled)
autoproj test --tool <pkg>      # stream real ctest/pytest output to STDOUT
```
**`autoproj test` silently does nothing** (exits 0, no output) when a package's
tests are **disabled** or **unavailable** — do not mistake that for "passed".
Check first with `autoproj test list <pkg>` (shows `Enabled` and `Available`):
- **Enabled = false** → turn tests on, rebuild so test targets exist, then run:
  ```bash
  autoproj test enable <pkg>    # persists in workspace config (revert: autoproj test disable <pkg>)
  amake --tool <pkg>            # build the tests
  autoproj test --tool <pkg>    # now run them
  ```
- **Available = false** (after enabling + building) → the package defines no
  runnable test suite; report that and stop, don't keep retrying.

For C++ packages, `autoproj test` typically calls `make test`, which can swallow
per-test output. Fallback — run from the package **build dir**, via the env:
```bash
.autoproj/bin/autoproj exec -- make test ARGS=-V
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
**succeeds**, re-source `env.sh` and retry. If it **fails**, the workspace is
broken: diagnose and *propose* a fix, but **request explicit user authorization
before any corrective action**. See [troubleshooting.md](./references/troubleshooting.md).

## Reference files

- [commands.md](./references/commands.md) — full CLI: subcommands, `amake`/`aup`/`alog`/`acd`, key flags (`--tool`, `-n`, `--rebuild`, `--force`, `--no-interactive`), `autoproj exec`, `autoproj which`, `autoproj envsh`.
- [package-types.md](./references/package-types.md) — autobuild package types, the build phases (import → prepare → build → install), and the concrete commands each type runs.
- [troubleshooting.md](./references/troubleshooting.md) — log locations, `build_report.json`, rebuild recipes, the `envsh` health-check ladder, and how to locate and read the autoproj/autobuild source for authoritative answers.
- [config-files.md](./references/config-files.md) — `manifest`, package sets / `source.yml`, `init.rb`, `overrides.rb`, `.autoproj/config.yml`, and the `installation-manifest` schema.
