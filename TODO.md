## TODO

- Add command to remove debug entry

- Add missing tests:
  - ConfigManager...
  - Commands.addPackageToTestMate
  - Commands.openWorkspace
  - Commands.removeTestMateEntry
- Refactor tests to use a real workspace instead of mocks (see `cpptools.test.ts`)
- Make output channel a singleton and use it in getLogger()
- Don't pass output channel anymore (getLogger() can be used anywhere)
- Add linter

See also [project issues](https://github.com/g-arjones/vscode-autoproj/issues).