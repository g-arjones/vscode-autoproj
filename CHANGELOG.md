# Change Log
All notable changes to the "Autoproj" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 0.2.2
- Fixed rubyLsp.rubyVersionManager not being set ([#39](https://github.com/g-arjones/vscode-autoproj/pull/39))

## 0.2.1
- Fixed package name if task progress view ([#37](https://github.com/g-arjones/vscode-autoproj/pull/37))
- Cleanup TestMate C++ entries when a folder is removed ([#38](https://github.com/g-arjones/vscode-autoproj/pull/38))

## 0.2.0
- Added a C++ configuration provider to setup IntelliSense (zero configuration required)
- Replaced rebornix.ruby with shopify.ruby-lsp
- Added a command to open an Autoproj workspace
- Added command to generate and overrides file that enables debugging symbols on CMake packages
- Added dependency on Pylance and TestMate C++
- Added command to start/restart a debugging session
- Added command to save/remove debugging session
- Added command to add/remove entry to TestMate C++
- Autoproj watch task is an internal child_proccess now
- Implemented auto setup (installs ruby-lsp dependencies, sets Python interpreter)

## 0.1.1
- All tasks are now silent (terminals will gain focus if the underlying process fails)
- Added basic progress notification for tasks
- Added configuration option to allow choosing which tasks to provide
- Added a "Rebuild" package task

## 0.1.0
- Initial release
