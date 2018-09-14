[![Build Status](https://travis-ci.org/g-arjones/vscode-autoproj.svg?branch=master)](https://travis-ci.org/g-arjones/vscode-autoproj)
[![Coverage Status](https://coveralls.io/repos/github/g-arjones/vscode-autoproj/badge.svg?branch=master)](https://coveralls.io/github/g-arjones/vscode-autoproj?branch=master)

# README

This extension provides basic services related to using Visual Studio Code to
work on an Autoproj managed workspace.

## Features

- Run autoproj commands directly from VSCode and see build/update errors in
  the problem view

## Installation

This extension depends on the Ruby vscode extension to allow formatting and code highlighting of autoproj/autobuild
configuration files. It should be installed automatically so you don't have to worry about that.

## Management of Autoproj Workspaces

The extension will start providing commands and support for a given Autoproj
workspace as soon as at least one package from this workspace is opened in
VSCode (via the "Add Folder to Workspace" command).

Once there is such a folder opened in VSCode, other packages from the same
workspace can easily be added with the `Autoproj: Add package to workspace` command
provided by this extension.

## Important Note about `env.sh`

**Note** there is no need to load the env.sh before you start vscode. Autoproj
generates its own environment. Loading env.sh is even harmful as it would break
if you were opening packages and programs from a different workspace than the one
you loaded the env.sh from.

## Autoproj Integration

The extension automatically creates tasks to handle the common
Autoproj operations. These tasks are available as soon as you add a folder that
is within an Autoproj workspace to your VSCode workspace.

Most autoproj subcommands are available as tasks (through the `Run Task` command).
The very-oft used build tasks are also available in the `Run Build Tasks`
command (under the Shift+Ctrl+B shortcut). The created tasks are either
applied to the whole workspace, or to specific packages.

**Tip** the last task(s) that have been run are at the top of the picker, which
gives a convenient way to run the same task over and over again.

**Important** if you create a new package, you must add it to the `layout`
section of `autoproj/manifest` and run the `Autoproj: Update package info`
command before the extension tools can be used for it.

## Known Issues

See [the issue page on GitHub](https://github.com/g-arjones/vscode-autoproj/issues)
