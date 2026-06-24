---
description: 'Editing or running Python packages in an autoproj workspace. Use when changing .py sources, working with setuptools/ament_python autobuild packages, or running python/pytest/linters inside the workspace environment.'
applyTo: "**/*.py"
---
# Python in an Autoproj Workspace

Python packages here are built by **autobuild** (the `Autobuild::Python` type,
setuptools-based; in ROS workspaces these are `ament_python`). See the `autoproj`
skill for command and lifecycle details.

## Build & run mechanics

- **Always operate inside the workspace environment** so the correct interpreter
  and dependencies are used: `source env.sh`, or
  `.autoproj/bin/autoproj exec -- python …` / `… pytest …`. Do not assume the
  system `python3`.
- Python packages typically **build in the source dir** (setuptools writes build
  artifacts under a generated build base). Build/refresh with `amake <pkg>`
  (add `--tool` for real output).
- Run tests with `autoproj test --tool <pkg>`. To run `pytest` directly, do it
  through the env: `.autoproj/bin/autoproj exec -- pytest <path>`.
- If `import <dep>` fails at run/test time for a dependency that *is* built,
  suspect a **missing dependency declaration** under `separate_prefixes`:
  autoproj only injects a dependency's prefix when it is listed in the package's
  `manifest.xml`/`package.xml` (in the source tree, or for some third-party
  packages in the owning package set under `manifests/<name>.xml`). Check it and,
  if the dependency is missing, **ASK the user** before adding it — do not add it
  silently.

## Editing conventions

- **Do not impose a style.** Detect and follow the package's own config if present:
  `setup.cfg`, `pyproject.toml`, `.flake8`, `tox.ini`, `mypy.ini`/`.mypy.ini`,
  `.ruff.toml`, `pyrightconfig.json` (search from the edited file up to the package
  root). Match surrounding code otherwise.
- Run the project's **own** linters/type-checkers (whatever it configures) inside
  the env rather than introducing new tools or rule sets.
- Keep edits in the package **source** tree; never modify generated build/install
  output or `.autoproj/` state.

## After editing

Refresh the package with `amake --tool <pkg>` (Python packages may still need an
install step so entry points / installed copies update), then run the relevant
tests via `autoproj test --tool <pkg>`.
