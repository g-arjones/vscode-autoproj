## TODO

- Refactor tests to use a real workspace instead of mocks (see `cpptools.test.ts`)
- Add missing tests:
  - ConfigManager...
  - Commands.addPackageToTestMate
  - Commands.openWorkspace
  - Commands.removeTestMateEntry
  - Commands.removeDebugConfiguration
- Minimize usage of mocks in tests
- Remove vscode wrapper
- Make output channel a singleton and use it in getLogger()
- Don't pass output channel anymore (getLogger() can be used anywhere)
- Add linter

See also [project issues](https://github.com/g-arjones/vscode-autoproj/issues).