---
description: 'Editing CMake build files in an autoproj workspace. Use when changing CMakeLists.txt or .cmake files for autobuild CMake packages, configuring targets/dependencies, or fixing configure-time errors.'
applyTo: "**/{CMakeLists.txt,*.cmake}"
---
# CMake in an Autoproj Workspace

CMake packages are built by autobuild's `Autobuild::CMake` type. Autoproj invokes
CMake for you — you edit `CMakeLists.txt`/`.cmake`, then build with `amake`.

## How autoproj drives CMake

- The build dir is **separate from the source dir** (default `build/` under the
  package source dir, but **configurable** — see the `autoproj` skill's
  config-files reference). Its real path is the `builddir` field in
  `.autoproj/installation-manifest`. Never edit files there.
- Autoproj passes `CMAKE_INSTALL_PREFIX`, `CMAKE_PREFIX_PATH`, and
  `CMAKE_MODULE_PATH` pointing at dependency prefixes, so `find_package` locates
  workspace-built dependencies. This works only inside the workspace environment.
- Changing `-D` options or cache variables triggers a reconfigure on the next build.

## Editing conventions

- **Never hardcode absolute workspace paths** (`/…/src`, `/…/build`, `/…/install`).
  Use `find_package(<dep>)`, `${CMAKE_CURRENT_SOURCE_DIR}`,
  `${CMAKE_INSTALL_PREFIX}`, and target-based linking
  (`target_link_libraries(... <dep>::<dep>)`).
- Express dependencies on other workspace packages via `find_package` so autoproj's
  prefix paths resolve them; declare the dependency in the package set / manifest
  if it isn't already a build dependency.
- Install artifacts with standard `install(...)` rules relative to the prefix; do
  not write to absolute locations.
- Don't lower `cmake_minimum_required` or change the project's generator/standard
  unless the task requires it.

## After editing

Reconfigure + build with `amake --tool <pkg>` to see real CMake configure and
compile output. If a stale cache causes trouble, use `amake --rebuild <pkg>`.
Inspect `<logdir>/<pkg>-build.log` (path from the installation-manifest) for
configure-time details.
