# Autobuild Package Types & Build Lifecycle

Autoproj delegates the actual building to **autobuild**. Each package has a
**type** (visible as `type` in `.autoproj/installation-manifest`) that determines
the commands run. You rarely invoke these directly — use `amake`/`autoproj test` —
but knowing them helps you read logs and diagnose failures.

## Build lifecycle (phases)

Every package goes through phases in order:

```
import → prepare → build → install
```

- **import** — checkout/update source via the package's VCS importer (Git, SVN,
  Hg, CVS, Archive…).
- **prepare** — configure the build system, resolve deps, run code generation.
- **build** — compile.
- **install** — copy artifacts into the package's prefix (install dir).

Completion is tracked with **stamp files**; autobuild also uses source-tree
**mtime** to decide whether a rebuild is needed. Touching a source file newer than
the build stamp triggers a rebuild; artificially old mtimes can suppress one.

## Package types and the commands they run

| Type | Build system | Where it builds | Roughly runs |
|------|--------------|-----------------|--------------|
| `Autobuild::CMake` | CMake | build dir (separate from src) | `cmake -D CMAKE_INSTALL_PREFIX=<prefix> -D CMAKE_PREFIX_PATH=<dep prefixes> … <srcdir>` then `make -jN` and `make -jN install` |
| `Autobuild::Autotools` | autoconf/automake | build dir | (regen: `aclocal`/`autoconf`/`automake` as needed) then `<srcdir>/configure --prefix=<prefix>`, `make -jN`, `make install` |
| `Autobuild::Python` | setuptools | **in srcdir** | `python setup.py … build --build-base=<builddir>` then `… install --prefix=<prefix>` |
| `Autobuild::Ruby` | Rake | **in srcdir** | `ruby -S rake <task>` (default/test) |
| `Autobuild::Orogen` | Orogen + CMake | build dir | Orogen code generation, then CMake build |
| `Autobuild::GenomModule` | Genom + Autotools | build dir | Genom code generation, then Autotools build |
| `Autobuild::ImporterPackage` | none | — | checkout/update only, no build |
| `Autobuild::DummyPackage` | none | — | no-op placeholder (often a metapackage) |

**Metapackages** group dependencies and have no build of their own — you cannot
`amake` them as if they produced artifacts; they just pull in their members.

## CMake specifics (most common)

- Build dir defaults to `build/` **under the package source dir** (configurable;
  see [config-files.md](./config-files.md)). The real path is the `builddir` field
  in the installation-manifest.
- Dependency prefixes are injected via `CMAKE_PREFIX_PATH` / `CMAKE_MODULE_PATH`,
  so `find_package` resolves workspace-built dependencies. This only works inside
  the workspace environment.
- Changing `-D` defines reconfigures `CMakeCache.txt` on the next build.

## Seeing real build output

Autoproj hides per-command output by default. To stream it:

```bash
amake --tool <pkg>              # real make/compiler output
autoproj test --tool <pkg>      # real ctest/pytest output
```

### Tests must be enabled
`autoproj test <pkg>` produces **no output and exits 0 when the package's tests
are disabled or unavailable** — that is not a pass. Check with
`autoproj test list <pkg>` (`Enabled`/`Available`); if disabled,
`autoproj test enable <pkg>` then rebuild (`amake --tool <pkg>`) before running.
See the troubleshooting and commands references.

### C++ test output gotcha
`autoproj test` for a CMake package usually calls `make test`, which can swallow
individual test output. Fall back to ctest verbose mode from the package
**build dir**, always inside the env:

```bash
.autoproj/bin/autoproj exec -- make test ARGS=-V
# ARGS=-V is forwarded to ctest -> verbose per-test output
```

## Parallelism

Autobuild auto-detects CPU count; override per-invocation with `-p N`/`--parallel N`
or workspace-wide via `parallel_build_level` in `.autoproj/config.yml`. Some
code-generating types may not parallelize internally.
