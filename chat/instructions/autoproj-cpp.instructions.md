---
description: 'Editing or building C/C++ packages in an autoproj workspace. Use when changing .cpp/.hpp/.cc/.h sources, working with CMake-built autobuild packages, running compilers, or fixing build/link errors inside the workspace environment.'
applyTo: "**/*.{cpp,cc,cxx,hpp,hh,hxx,h,c}"
---
# C/C++ in an Autoproj Workspace

C/C++ packages here are built by **autobuild** (almost always the `Autobuild::CMake`
type). See the `autoproj` skill for command and lifecycle details.

## Build & test mechanics

- **Build through autoproj**, not raw `cmake`/`make`: `amake <pkg>` (add `--tool`
  to see real compiler output; `--rebuild` for a clean build; `-n` to skip deps).
- The build dir is **separate from the source dir** and is generated — never edit
  files under it. Get its real path from `builddir` in `.autoproj/installation-manifest`.
- `find_package` resolves workspace-built dependencies via `CMAKE_PREFIX_PATH` /
  `CMAKE_MODULE_PATH`, which are only set **inside the workspace environment**.
  Always `source env.sh` or use `.autoproj/bin/autoproj exec -- <cmd>`.
- Run tests with `autoproj test --tool <pkg>`. If `make test` swallows output,
  fall back from the package build dir to
  `.autoproj/bin/autoproj exec -- make test ARGS=-V` (verbose ctest).
- If `find_package(<dep>)` fails (or a dependency's headers/libraries aren't
  found) for a dependency that *is* built, suspect a **missing dependency
  declaration** under `separate_prefixes`: autoproj only injects a dependency's
  prefix when it is listed in the package's `manifest.xml`/`package.xml` (in the
  source tree, or for some third-party packages in the owning package set under
  `manifests/<name>.xml`). Check it and, if the dependency is missing, **ASK the
  user** before adding it — do not add it silently.

## Editing conventions

- **Do not introduce a formatting/lint style.** Detect and follow the package's
  own configuration if present: `.clang-format`, `.clang-tidy`, `.editorconfig`
  (search from the edited file up to the package root). Match the surrounding code
  when no config exists.
- Keep changes confined to the package's **source** tree; never write into build
  or install/prefix directories.
- Don't hardcode absolute workspace paths (`src/…`, `build/…`, `install/…`) in
  code or includes — rely on CMake targets and `find_package`.

## After editing

Rebuild the affected package with `amake --tool <pkg>` and read the real compiler
errors. For deeper diagnosis, consult `<logdir>/<pkg>-build.log` and the
`autoproj` skill's troubleshooting reference.
