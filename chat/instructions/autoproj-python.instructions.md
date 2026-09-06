---
description: 'Editing or running Python packages in an autoproj workspace. Use when changing .py sources, working with setuptools/ament_python autobuild packages, or running python/pytest/linters inside the workspace environment.'
applyTo: "**/*.py"
---
# Python in an Autoproj Workspace

Python packages here are built by **autobuild** (the `Autobuild::Python` type,
setuptools-based; in ROS workspaces these are `ament_python`). See the `autoproj`
skill for command and lifecycle details.

## Build & run mechanics

- **Run every package command from its resolved `srcdir`, not the workspace
  root.** Read `srcdir` from the workspace's `.autoproj/installation-manifest` and
  set the working directory explicitly (or `cd "$srcdir" && <cmd>`). This applies
  to builds, tests, linters, and type-checkers; a package name or absolute test
  path is not enough to scope working-directory scans and configuration lookup.
  Change directory before launching `autoproj exec`, not inside its child shell.
- **Always operate inside the workspace environment** so the correct interpreter
  and dependencies are used: `source "$root/env.sh"`, or
  `"$root/.autoproj/bin/autoproj" exec -- <cmd>`, where `root` is the absolute
  workspace root. These paths must remain valid from `srcdir`. Do not assume the
  system `python3`, or that a previous `exec` call activated the current shell.
- Python packages typically **build in the source dir** (setuptools writes build
  artifacts under a generated build base). Build/refresh with `amake <pkg>` or
  just `amake` from `srcdir` (add `--tool` for real output).
- **Before running Python tests, choose one of these prerequisites:**
  - **Build/install route:** successfully run `amake <pkg>` (or `amake` from
    `srcdir`) after source changes, then `autoproj test --tool <pkg>` or a focused
    direct `pytest` inside the env.
  - **Direct source route:** activate the workspace env first, then prepend the
    package's `srcdir` to `PYTHONPATH` for the test command, preserving its existing
    value. Use this for focused tests without refreshing the install:
    ```bash
    source "$root/env.sh" &&
    cd "$srcdir" &&
    PYTHONPATH="$srcdir${PYTHONPATH:+:$PYTHONPATH}" pytest <test-path>
    ```
    Keep **double quotes** so variables expand, not single quotes. This handles
    unset/empty `PYTHONPATH` without an empty path entry. It does not
    build missing dependencies or generated artifacts.
  **The workspace env alone is not sufficient:** the package under test may be
  absent from it, or its installed copy may be stale. Setting `PYTHONPATH` does
  not replace running from `srcdir`.
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
  the env **with `srcdir` as the working directory**, rather than introducing new
  tools or rule sets. Never run a package's linter from the workspace root, even
  when passing a path to that package.
- Keep edits in the package **source** tree; never modify generated build/install
  output or `.autoproj/` state.

## After editing

From `srcdir`, refresh the package with `amake --tool <pkg>` (entry points /
installed copies may need updating), then run the relevant tests via
`autoproj test --tool <pkg>`. For focused direct tests without installing, use
the source-first `PYTHONPATH` route above instead.
