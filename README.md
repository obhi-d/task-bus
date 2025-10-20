# Task Bus

Task Bus is a lightweight Visual Studio Code extension that adds status bar controls for both workspace tasks and launch configurations:

- A task selector that lists every task defined in your workspace `.vscode/tasks.json`.
- A play button that runs the currently selected task.
- A launch selector that lists every launch configuration defined in your workspace `.vscode/launch.json`.
- A rocket button that starts the currently selected launch configuration.

## Features

- Quickly switch between workspace tasks and launch configurations from pick lists.
- Persist the last selected task and launch configuration per workspace.
- Detect updates to `.vscode/tasks.json` and `.vscode/launch.json` and refresh the available entries automatically.
- Hide either set of controls via settings if you only need one of them.

## Getting Started

1. Run `npm install`.
2. Press `F5` in VS Code to launch a new Extension Development Host window.
3. Use the status bar controls to select and run tasks or launch configurations.

## Commands

- `Task Bus: Select Task`
- `Task Bus: Run Task`
- `Task Bus: Select Launch Configuration`
- `Task Bus: Run Launch Configuration`

All commands are accessible via the Command Palette.

## Settings

- `task-bus.showTaskBus` (default: `true`) — Show or hide the task selector and run button.
- `task-bus.showLaunchBus` (default: `true`) — Show or hide the launch selector and run button.
