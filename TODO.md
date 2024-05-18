## TODO

- When a folder is added/removed:
  - Warn if working on a single folder (ask to save workspace)
  - Show error if multiple autoproj workspaces are open
  - Set "test.executables" to an empty string
  - Run all integration setup (if necessary and if workspace is saved and a single autoproj workspace is open)

- Add missing tests:
  - Commands.addPackageToTestMate
  - Commands.openWorkspace
  - testMate.cleanupExecutables
- Refactor tests to use a real workspace instead of mocks (see `cpptools.test.ts`)
- Make output channel a singleton and use it in getLogger()
- Don't pass output channel anymore (getLogger() can be used anywhere)
- Add linter

See also [project issues](https://github.com/g-arjones/vscode-autoproj/issues).