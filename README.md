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
- Optimistic checkbox updates and coordinated background refreshes keep focus, selection, and scrolling stable while Git is busy.
- `Commit` and `Commit and Push...` buttons inside the panel.
- `Amend` support for updating the previous commit.
- AI commit message generation through the VS Code Language Model API, with a panel language selector for Auto, English, or Russian output.
- Leaves the user's global VS Code accessibility and sound preferences unchanged.
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

The `Generate` button uses VS Code's built-in Language Model API. It does not require a separate OpenAI API key in this extension.

Requirements:

- VS Code with Language Model API support.
- GitHub Copilot Chat or another VS Code language model provider signed in and enabled.
- At least one checked/staged change.

Use the language selector beside `Generate` to choose Auto, English, or Russian commit message generation.

VS Code may ask for permission the first time the extension sends a language model request.

## Packaging and installation

Clone the repository and package it as a VSIX with the VS Code Extension Manager:

```powershell
npx @vscode/vsce package
code --install-extension .\phpstorm-git-panel-0.3.5.vsix
```

For a WSL remote extension host, install that VSIX into the target WSL window:

```powershell
code --remote wsl+Ubuntu --install-extension .\phpstorm-git-panel-0.3.5.vsix
```

Reload VS Code after installation and open the `PhpStorm Git` Activity Bar item.

## Commands

- `PhpStorm Commit Panel: Refresh PhpStorm Commit Panel`
- `PhpStorm Commit Panel: Check All Changes`
- `PhpStorm Commit Panel: Uncheck All Changes`
- `PhpStorm Commit Panel: Generate Commit Message`
- `PhpStorm Commit Panel: Commit Checked Changes`
- `PhpStorm Commit Panel: Commit and Push Checked Changes`
- `PhpStorm Commit Panel: Open PhpStorm Commit Panel Settings`

## Keywords

VS Code extension, Visual Studio Code extension, PhpStorm commit panel, JetBrains Git UI, Git commit panel, source control, staged checkboxes, AI commit message, Copilot commit message.
