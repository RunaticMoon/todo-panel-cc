# todo-panel

A Claude Code mod that keeps the steps **you** have to do yourself in view.

When Claude hands you a checklist mid-conversation (review and merge a PR, check something in a web UI, run a command only you can run), the list scrolls away as the conversation goes on. todo-panel pins that list in a band right above the prompt and shows the next step by default:

```
📋 다음 할 일 1/4 · PR 리뷰와 머지
2. [1. PR 리뷰와 머지] #100을 리뷰받고 master에 머지합니다.
[ ✓ 완료 ] [ 전체 (4) ] [ 숨기기 ]
```

- **전체** expands the whole list, grouped by section (✓ done, ▶ next, ○ open). Click a step to toggle it.
- Once every step is done the band says so and offers **지우기** (clear).
- Hotkeys d / a / h / c (and q to close the pane) work while the band or pane has focus (ctrl+x tab).
- In the fullscreen layout (`/tui fullscreen`) every button and every step in the expanded list takes a mouse click.
- The next step is also pinned as a status line under the prompt (`todo-panel: 📋 다음 할 일 2/4: …`), which no other plugin can cover.

### When another plugin holds the band

The band above the prompt draws one tree. A plugin that draws its own band without passing it on (a custom effort/status panel, say) hides todo-panel's band. todo-panel notices that its band never runs and opens a **pane** with the full list instead, docked beside the transcript. A pane the model's tool call opens on its own is drawn only on terminals at least 144 columns wide; `/todo` or `/todo pane` opens it at any width. The status line shows the next step either way.

When todo-panel is the one above, it keeps whatever the plugins beneath draw, under its list.

## How the list gets there

The mod adds a short, static note to the session through a SessionStart hook, so it is there at every startup, resume, clear and compact. It also adds two tools:

- `set_user_tasks`: Claude calls it when its reply gives you two or more steps to do yourself.
- `mark_user_tasks`: Claude calls it when you say you finished (or undid) a step, e.g. "#100 머지했어".

The list itself never goes into the system prompt, so changing it does not invalidate the prompt cache.

If Claude did not pin a list, `/todo scan` asks a fork of the conversation to find the latest one.

Scanning the same steps again keeps the panel's checked and unchecked states. Steps
match only when their count, order, text and groups are unchanged (the title may
change). Other lists replace the current one. If you change or clear the list, or
start another scan while one is pending, its late result is skipped with a retry
message instead of overwriting your work.

## Commands

| Command | What it does |
| --- | --- |
| `/todo` | Toggle between the next step and the full list (opens the pane when the band is held) |
| `/todo pane` / `/todo close` | Open or close the full list in a pane (the pane's **닫기** button and its ✕ close it too) |
| `/todo done [n…]` | Mark the next step (or steps n…) done |
| `/todo undo <n…>` | Mark steps n… not done |
| `/todo scan` | Find the latest list in Claude's replies and pin it |
| `/todo show` / `/todo hide` | Show (expanded) or hide the band |
| `/todo clear` | Remove the list |

The list belongs to the session: it is gone after `--resume`.

## Install

At the prompt of a terminal session:

```
/plugin install todo-panel --marketplace RunaticMoon/todo-panel-cc
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install todo-panel --marketplace RunaticMoon/todo-panel-cc
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `RunaticMoon/todo-panel-cc`, then Add plugin.

## Updates

The plugin has no pinned `version`, so every commit pushed to this repository is a new version.

Auto-update is off by default for third-party marketplaces. Turn it on once:

1. Run `/plugin`, open **Marketplaces**, select `todo-panel-cc`.
2. Choose **Enable auto-update**.

From then on Claude Code refreshes the marketplace in the background after a session starts and updates the installed copy; you see `Plugin updated: todo-panel · Run /reload-plugins to apply`, and the next session loads the new version.

Or declare it in `~/.claude/settings.json`, which also adds the marketplace on a new machine:

```json
{
  "extraKnownMarketplaces": {
    "todo-panel-cc": {
      "source": { "source": "github", "repo": "RunaticMoon/todo-panel-cc" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "todo-panel@todo-panel-cc": true }
}
```

To update by hand instead:

```
claude plugin update todo-panel@todo-panel-cc
```

## Developing

```
claude --plugin-dir /path/to/todo-panel-cc   # load it from this folder
claude plugin validate .                      # check manifest and hooks
claude plugin test .                          # run hooks/*.test.ts
```
