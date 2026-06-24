# Configuration & State Files

## Editable workspace config — `autoproj/`

| File | Controls | Notes |
|------|----------|-------|
| `autoproj/manifest` | Active package sets, the `layout` (what gets built), `exclude_packages`, `ignored_packages`, `constants` | YAML. The primary thing you edit to add/remove packages from the build. |
| `autoproj/init.rb` | Early Ruby config: env vars, build options, config defaults | Runs during setup. |
| `autoproj/overrides.rb` | Override package definitions/options at load time | Ruby. e.g. force `CMAKE_BUILD_TYPE`. |
| `autoproj/overrides.d/*.rb` / `*.yml` | Additional overrides (merged) | Drop-in files. |

There may be alternate manifests (e.g. `manifest.<variant>`). Select one with
`autoproj manifest <name>`.

### Manifest shape (example)
```yaml
package_sets:
    - type: git
      url: <package-set repository URL>

layout:
    - some_package
    - some_group/specific_package

exclude_packages:
    - pkg_to_skip
```

## Package sets

A **package set** is a VCS repository (cloned into `.autoproj/remotes/`) that
*defines* packages. Key files inside a package set:

- `source.yml` — package names, VCS locations, dependencies, metadata.
- `*.autobuild` — Ruby build definitions for packages.
- `*.osdeps` — OS package mappings (apt/brew/…).

To add a brand-new package you typically: add its build definition + `source.yml`
entry in a package set, then add it to the `layout` in `autoproj/manifest`.

> `.autoproj/remotes/` holds **clones** of package sets. They are ephemeral and
> refreshed by `autoproj update` — do not edit them; edit the upstream package set.

## Package manifests (dependency declarations)

A package's manifest declares its dependencies (and metadata). Autoproj reads it to
build the dependency graph, which drives build order and — under
`separate_prefixes` — which dependency prefixes get injected into the package's
environment.

A manifest can live in **two places**, checked in this order:

1. **In the package source tree (preferred):** `<srcdir>/manifest.xml`, or
   `<srcdir>/package.xml` for ROS packages (`use_package_xml`).
2. **In the owning package set (fallback):**
   `<package_set>/manifests/<package_name>.xml` (non-ROS `manifest.xml` only). This
   is common for **third-party packages** whose upstream source you don't control,
   so the dependency declaration is maintained alongside the package definition
   instead of in the source tree.

When inspecting or editing a package's declared dependencies, check the source
tree first, then the owning package set's `manifests/` directory.

## Generated state — `.autoproj/` (do not edit)

### `.autoproj/config.yml`
Workspace configuration, including the **path layout keys**:

| Key | Default | Meaning |
|-----|---------|---------|
| `source` | `nil` | Folder that package source dirs are laid out under. `nil` ⇒ relative to the workspace root. Relative paths only. |
| `build` | `"build"` | Build dir. **Relative** ⇒ per-package, under each package's source dir. **Absolute** ⇒ a shared root with the package name appended. |
| `prefix` | `"install"` | Install/prefix dir (relative to root unless absolute). |
| `separate_prefixes` | `false` | If true, one prefix per package instead of a shared one. |
| `parallel_build_level` | (CPU count) | Default parallel jobs. |

Because these are configurable, **never hardcode `src/`, `build/`, or `install/`** —
read the resolved paths from the installation-manifest (below).

> **`separate_prefixes` caveat.** With one prefix per package, a dependency's
> prefix is added to a package's environment **only if the dependency is declared
> in that package's `manifest.xml` / `package.xml`**. An undeclared dependency
> that happens to work under a shared prefix will break here (failed
> `find_package`, missing headers/libs, failed Python imports). See the
> troubleshooting reference — check the manifest and **ASK the user** before
> adding a missing dependency.

### `.autoproj/installation-manifest` — authoritative path source
A YAML file autoproj regenerates on import/build. It contains, per package:

| Field | Use |
|-------|-----|
| `name` | Package name |
| `type` | Autobuild class (e.g. `Autobuild::CMake`) |
| `vcs` | VCS definition |
| `srcdir` | **Source directory — edit here** |
| `importdir` | Import root (may differ from srcdir) |
| `builddir` | Build directory (for buildable types) |
| `prefix` | Install/prefix directory |
| `logdir` | Where `<pkg>-<phase>.log` files live |
| `dependencies` | Names this package depends on |

It also has `package_set` entries (with `name`, `vcs`, `raw_local_dir`,
`user_local_dir`). **Prefer this file over `alocate`** for resolving any package
path. To read a single field quickly you can parse the YAML, or use
`.autoproj/bin/autoproj exec -- ruby` with the `Autoproj::InstallationManifest`
API if Ruby is convenient.

### Other generated paths (do not edit)
- `.autoproj/remotes/` — package-set clones.
- `env.sh`, `env.bash` — environment scripts (regenerate with `autoproj envsh`).
- Build dir & install/prefix dir — autobuild output.
