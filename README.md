# PhpStorm Commit Panel for VS Code

Repository: [VitalyLitvinov74/vscode-phpstorm-commit-panel](https://github.com/VitalyLitvinov74/vscode-phpstorm-commit-panel)

JetBrains PhpStorm-style Git commit panel for Visual Studio Code.

This VS Code extension adds a separate Activity Bar view with a split commit workflow similar to PhpStorm: checked files are staged automatically, unchecked files are unstaged, and the commit editor stays beside the changes list.

## Features

- Standalone Activity Bar panel, not a replacement for VS Code Source Control.
- PhpStorm-like split layout: changes list on the left, commit message panel on the right.
- Resizable left/right panes with a draggable splitter.
- Cleaner JetBrains-style changes list with compact header, status badges, selection states, and empty state.
- Checkbox staging: checked means `git add`, unchecked means `git restore --staged`.
- `Commit` and `Commit and Push...` buttons inside the panel.
- `Amend` support for updating the last commit.
- Last commit summary in the commit header.
- AI commit message generation through the VS Code Language Model API, using GitHub Copilot Chat or another installed VS Code language model provider when available.
- Works with local and remote VS Code extension hosts, including WSL, when installed in that host.

## Why this exists

VS Code's built-in Source Control view is powerful, but many developers moving from JetBrains IDEs expect the commit workflow to look and behave like PhpStorm. This extension focuses on that specific workflow:

1. Review changed files.
2. Check files to include in the commit.
3. Generate or type the commit message.
4. Commit or commit and push without leaving the panel.

## AI commit message generation

The `Generate` button uses VS Code's built-in Language Model API. It does not require a separate OpenAI API key in this extension.

Requirements:

- VS Code with Language Model API support.
- GitHub Copilot Chat or another VS Code language model provider signed in and enabled.
- At least one checked/staged change.

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
