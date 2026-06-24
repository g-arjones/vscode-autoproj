---
description: 'Scaffold a new autobuild package (CMake or Python) and register it in a package set and the manifest layout.'
argument-hint: '<package-name> [cmake|python]'
agent: agent
---
Create a new autoproj package: **${input:package:new package name}**
(type: ${input:type:cmake or python}).

Follow the `autoproj` skill (see its config-files reference for manifest and
package-set structure). Keep everything generic — do not assume any project-specific
generator tooling unless you find it configured in this workspace.

Steps:
1. **Confirm conventions first.** Inspect an existing package of the same type in
   this workspace to match its directory layout, build files, and metadata. Read
   `autoproj/manifest` and the relevant package set's `source.yml` to see how
   packages are declared here.
2. **Scaffold the source tree** in the appropriate source location (resolve where
   packages live from `.autoproj/config.yml` / installation-manifest — do not
   hardcode `src/`):
   - CMake: `CMakeLists.txt` (matching the project's CMake conventions), a minimal
     source/header, and an `install(...)` rule; add a test target if the project
     pattern includes one.
   - Python: `setup.py`/`setup.cfg` (or `pyproject.toml`) and a package directory
     with `__init__.py`, mirroring an existing Python package here.
3. **Declare the package** in the package set (its build definition + `source.yml`
   entry) following the existing entries' style.
4. **Add it to the build** by inserting it into the `layout` of `autoproj/manifest`.
5. **Verify** with `amake --tool <pkg>` inside the env, and report the result.

Before editing any file under `autoproj/` or a package set, summarize the intended
changes. Do not modify generated directories. Use `--no-interactive`.
