---
description: 'Always-on conventions for working in an autoproj workspace: generated vs editable dirs, sourcing the env, building/testing through autoproj, path resolution, and breakage handling. Applies to every task in an autoproj workspace.'
applyTo: '**'
---
# Autoproj Workspace — Agent Guide

This is an **autoproj** workspace (a Ruby-based, multi-repository source/package
manager built on **autobuild**). These rules apply to every task. For commands,
package-type build recipes, troubleshooting, and config-file details, use the
`autoproj` skill.

## Workspace layout (do not assume — verify)

- `autoproj/` — workspace config (`manifest`, `init.rb`, `overrides.rb`, `overrides.d/`). **Editable.**
- `.autoproj/` — autoproj internal state (`config.yml`, `remotes/`, `installation-manifest`). **Generated — do not edit.**
- Source packages, build dir, and install/prefix dir — **locations are configurable** (`.autoproj/config.yml` keys `source`, `build`, `prefix`). Defaults are `<root>`/`src`, `build/`, `install/`, but **never hardcode them**.
- `env.sh` / `env.bash` — **generated** environment scripts. **Do not edit.**

## Golden rules

1. **Edit source only.** Never modify anything under the build dir, install/prefix dir, `.autoproj/`, `env.sh`, `env.bash`, or `.autoproj/remotes/` — they are generated and will be overwritten.
2. **Resolve real paths from `.autoproj/installation-manifest`** (YAML: per-package `srcdir`, `builddir`, `prefix`, `logdir`, `dependencies`). Do **not** rely on `alocate` (known to be buggy) and do **not** hardcode `src/`, `build/`, `install/`.
3. **Always run tools inside the workspace environment.** Either `source env.sh` first, or wrap each command with `.autoproj/bin/autoproj exec -- <cmd>`. Outside the env, libraries and tools are not on the path.
4. **Build and test through autoproj**, not raw `cmake`/`make`/`colcon`/`pytest`: use `amake` (build), `autoproj test`, `aup` (update). To **see the real underlying build/test output**, pass `--tool` (e.g. `amake --tool <pkg>`, `autoproj test --tool <pkg>`); it streams `make`/`ctest` output to STDOUT instead of hiding it.
5. **For C++ test output that `make test` swallows**, fall back to `make test ARGS=-V` from the package build dir — always via the env (`.autoproj/bin/autoproj exec -- make test ARGS=-V`).
6. **`autoproj test` is silent when a package's tests are disabled/unavailable** (exit 0, no output) — that is *not* a pass. Check with `autoproj test list <pkg>` (`Enabled`/`Available`); if disabled, `autoproj test enable <pkg>` (persists), then rebuild and run.
7. **Never block on prompts.** Pass `--no-interactive` (or set `AUTOPROJ_NONINTERACTIVE=1`) for automation.
8. **Build a single package with its deps:** `amake <pkg>`; add `-n`/`--no-deps` to build only that package (deps must already be built).
9. **Missing dependency under `separate_prefixes`.** If a build/run fails because a *built* dependency isn't visible (failed `find_package`, missing headers/libs, failed Python import), autoproj likely didn't inject its prefix because it's **not declared in the package's `manifest.xml`/`package.xml`**. The manifest lives in the package source tree, or — often for third-party packages — in the owning package set under `manifests/<name>.xml`. Check it and, if the dependency is missing, **ASK the user** before adding it — never add it silently.

## When things break

If basic commands start failing, run `autoproj envsh` as a health check (it reloads
the workspace and regenerates the env). **If `autoproj envsh` itself fails, the
workspace is broken.** You may diagnose and *suggest* fixes, but you **MUST request
explicit user authorization before running any corrective action** (e.g.
`reconfigure`, reinstall, deleting state, or modifying `autoproj/` config).