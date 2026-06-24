# Autoproj & Autobuild Command Reference

All commands assume the workspace environment is active: either `source env.sh`
first, or wrap the command with `.autoproj/bin/autoproj exec -- <cmd>`.

## Convenience executables (shortcuts)

Autoproj installs short aliases (see the workspace's `bin/` and the autoproj
gemspec executables `autoproj aup amake alocate alog`):

| Alias | Equivalent | Purpose |
|-------|------------|---------|
| `amake [pkg]` | `autoproj build [pkg]` | Build a package (and deps) |
| `aup [pkg]` | `autoproj update [pkg]` | Import/update a package (and deps) |
| `alog` | `autoproj log` | Browse the workspace operation log |
| `alocate [pkg]` | `autoproj locate [pkg]` | Print a package path — **buggy; prefer the installation-manifest** |
| `acd [pkg]` | (shell function) | `cd` into a package's source dir |

With no package argument, `amake`/`aup` act on the package owning the current
directory. `amake .` explicitly targets the current-directory package.

## Core subcommands

| Command | What it does |
|---------|--------------|
| `autoproj build [pkgs]` | Build selected packages (incremental) |
| `autoproj update [pkgs]` | Fetch/checkout packages + their deps |
| `autoproj test [pkgs]` | Run package test suites (only those **enabled**; see Test enablement below) |
| `autoproj status [pkgs]` | Show VCS sync status of packages |
| `autoproj osdeps` | Install OS-level dependencies |
| `autoproj envsh` | Reload workspace and regenerate `env.sh` (also a health check) |
| `autoproj exec -- <cmd>` | Run `<cmd>` inside the workspace environment |
| `autoproj which <cmd>` | Resolve a command's full path in the workspace env |
| `autoproj show [pkgs]` | Show package metadata, VCS, dependencies |
| `autoproj locate [pkg]` | Print src/build path (**buggy** — prefer installation-manifest) |
| `autoproj clean [pkgs]` | Remove build byproducts |
| `autoproj cache` | Create/update an import cache |
| `autoproj manifest [name]` | Select/show the active manifest |
| `autoproj reconfigure` | Re-run configuration questions |
| `autoproj versions` / `tag` / `reset` | Snapshot / tag / restore package versions |
| `autoproj bootstrap` | Initialize a new workspace (rarely needed inside an existing one) |

## Key flags

### Build / test
- `--tool` — **tool mode.** Transparently passes the underlying build/test tool's
  output (e.g. `make`, `ctest`) to STDOUT and suppresses autoproj's own progress
  UI. **Use this whenever you need to read the real compiler/test output.**
- `-n`, `--no-deps` — operate on the named package(s) only, ignoring dependencies.
- `--rebuild` — clean and rebuild from scratch.
- `--force` — force all build steps without cleaning.
- `-p N`, `--parallel N` — max parallel jobs.
- `-k`, `--keep-going` — continue past failures where possible.
- `--auto-exclude` — exclude packages that fail to import from the build.

> `--rebuild`/`--force` on the **whole** workspace asks for confirmation; pass a
> package selection or `--no-confirm` to avoid the prompt.

### Test enablement (important)

`autoproj test <pkg>` runs `autoproj test exec` and **silently no-ops (exit 0, no
output) when the package's tests are disabled or unavailable** — do not read "no
output" as "tests passed". Inspect and manage enablement with the `test`
subcommands:

| Command | What it does |
|---------|--------------|
| `autoproj test list [pkgs]` | Show each package's `Enabled` and `Available` status |
| `autoproj test enable [pkgs]` | Enable tests (persists in workspace config) |
| `autoproj test disable [pkgs]` | Disable tests (persists in workspace config) |
| `autoproj test default on\|off` | Set the workspace-wide default for new packages |
| `autoproj test [exec] [pkgs]` | Run the enabled tests (`exec` is the default command) |

Typical flow when tests seem to do nothing:
`autoproj test list <pkg>` → if disabled, `autoproj test enable <pkg>` →
`amake --tool <pkg>` (build the test targets) → `autoproj test --tool <pkg>`.
If `Available` stays false after enabling and building, the package has no
runnable test suite.

### Global
- `--no-interactive` — never prompt (pair with `AUTOPROJ_NONINTERACTIVE=1`).
- `--verbose`, `--debug` — more output for diagnosis.
- `--no-color`, `--no-progress` — cleaner output for logs/automation.

## Recipes

```bash
# See exactly why a build fails, with live compiler output:
amake --tool <pkg>

# Build only one package, deps already built:
amake -n <pkg>

# Run one package's tests with full ctest output:
autoproj test --tool <pkg>
# or, for C++ when make test hides output, from the package build dir:
.autoproj/bin/autoproj exec -- make test ARGS=-V

# Run an arbitrary tool inside the env without sourcing:
.autoproj/bin/autoproj exec -- <cmd> [args...]

# Health check after weird failures:
autoproj envsh
```
