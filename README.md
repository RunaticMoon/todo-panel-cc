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
- Hotkeys d / a / h / c work while the band has focus (ctrl+x tab).

## How the list gets there

The mod adds a short, static section to the system prompt and two tools:

- `set_user_tasks`: Claude calls it when its reply gives you two or more steps to do yourself.
- `mark_user_tasks`: Claude calls it when you say you finished (or undid) a step, e.g. "#100 머지했어".

The list itself never goes into the system prompt, so changing it does not invalidate the prompt cache.

If Claude did not pin a list, `/todo scan` asks a fork of the conversation to find the latest one.

## Commands

| Command | What it does |
| --- | --- |
| `/todo` | Toggle between the next step and the full list |
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
