# PhpStorm Commit Panel for VS Code

Repository: [VitalyLitvinov74/vscode-phpstorm-commit-panel](https://github.com/VitalyLitvinov74/vscode-phpstorm-commit-panel)

JetBrains PhpStorm-style Git commit panel for Visual Studio Code.

This VS Code extension adds a separate Activity Bar view with a commit workflow similar to PhpStorm: checked files are staged automatically, unchecked files are unstaged, and an optional inline diff keeps review and commit controls in one panel.

## Features

- Standalone Activity Bar panel, not a replacement for VS Code Source Control.
- PhpStorm-like responsive layout: changes and commit controls stay side by side normally; with preview enabled, changes move above the commit form and the diff opens on the right.
- Resizable left/right panes with a draggable splitter.
- JetBrains-style folder tree in the changes panel with expandable folders and folder-level checkboxes.
- PhpStorm-style eye menu with `Directory`, `Flat List`, and `Ignored Files` view options.
- Separate Preview Details button, matching the control used by PhpStorm instead of overloading the eye action.
- Real unified and side-by-side Git diff preview with previous/next difference and file navigation.
- Whole-file and individual hunk inclusion controls for partial staging.
- Whitespace policies, line/word/character highlighting, collapsed unchanged lines, line numbers, whitespace marks, indent guides, soft wrap, breadcrumbs, and Git blame annotations.
- Selected-file rollback and recoverable shelving actions with an explicit confirmation dialog.
- Cleaner changes list with compact header, status badges, selection states, and empty state.
- Theme-safe Activity Bar icon for dark VS Code themes.
- Checkbox staging: checked means `git add`, unchecked means `git restore --staged`.
- `Commit` and `Commit and Push...` buttons inside the panel.
- `Amend` support for updating the previous commit.
- Configurable AI commit message generation through the standard VS Code Language Model API or a local Codex CLI installation, with a panel language selector for Auto, English, or Russian output.
- Disables VS Code accessibility signal sounds for this host so opening and clicking diff lines stays silent.
- Works with local and remote VS Code extension hosts, including WSL, when installed in that host.

The eye and Preview Details toolbar assets come from the JetBrains Platform under
Apache License 2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Why this exists

VS Code's built-in Source Control view is powerful, but many developers moving from JetBrains IDEs expect the commit workflow to look and behave like PhpStorm. This extension focuses on that specific workflow:

1. Review changed files.
2. Check files to include in the commit.
3. Generate or type the commit message.
4. Commit or commit and push without leaving the panel.

## AI commit message generation

The sparkles button generates a message from the checked/staged diff. The standard provider remains VS Code's built-in Language Model API, so existing setups keep working without configuration changes.

Open `PhpStorm Commit Panel` settings from the gear button to select one of these providers:

- `VS Code Language Model (Standard)` uses GitHub Copilot Chat or another enabled VS Code language model provider.
- `Codex CLI` runs the locally installed `codex exec` command with the CLI's existing authentication. The default model is `gpt-5.6-luna` with `low` reasoning effort for this short, repeatable task.

Codex CLI setup:

1. Install Codex CLI and run `codex login` in a terminal.
2. Set `phpstormGitPanel.commitMessageGenerator` to `codexCli`.
3. Optionally choose another model, reasoning effort, executable path, or timeout in VS Code settings.

The extension never asks for, reads, stores, or logs an API key. Authentication remains owned by Codex CLI. The staged diff is sent through the child process standard input instead of command-line arguments, and Codex runs in an ephemeral read-only session.

At least one change must be checked. Use the language selector beside the sparkles button to choose Auto, English, or Russian output.

VS Code may ask for permission the first time the extension sends a language model request.

## Installation from source

Clone the repository, then install the extension folder into VS Code:

```powershell
code --install-extension .
```

For a WSL remote extension host:

```powershell
code --remote wsl+Ubuntu --install-extension .
```

Reload VS Code after installation and open the `PhpStorm Git` Activity Bar item.

## Commands

- `PhpStorm Commit Panel: Refresh PhpStorm Commit Panel`
- `PhpStorm Commit Panel: Check All Changes`
- `PhpStorm Commit Panel: Uncheck All Changes`
- `PhpStorm Commit Panel: Generate Commit Message`
- `PhpStorm Commit Panel: Commit Checked Changes`
- `PhpStorm Commit Panel: Commit and Push Checked Changes`

## Keywords

VS Code extension, Visual Studio Code extension, PhpStorm commit panel, JetBrains Git UI, Git commit panel, source control, staged checkboxes, AI commit message, Copilot commit message.
