import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { TaskList } from '../types'
import { describe, doneCount, markTasks, nextIndex, parseJsonObject, parseTasks, statusLine, toIndexes } from './tasks'

const list = atom({ plugin: 'todo-panel', key: 'list' } as const, null)
const isExpanded = atom({ plugin: 'todo-panel', key: 'isExpanded' } as const, false)
const isHidden = atom({ plugin: 'todo-panel', key: 'isHidden' } as const, false)

const SET_TOOL = 'mcp__todo-panel__set_user_tasks'
const MARK_TOOL = 'mcp__todo-panel__mark_user_tasks'
const PANE = 'todo-panel'

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short heading for the whole list, in the user\'s language' },
    tasks: {
      type: 'array',
      description: 'Every step the user must do, in the order they should do them',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One action, as you wrote it to the user (one or two sentences)' },
          group: { type: 'string', description: 'The section it belongs to, e.g. "1. PR 리뷰와 머지"' },
          done: { type: 'boolean', description: 'True when the user already did it' },
        },
        required: ['text'],
      },
    },
  },
  required: ['tasks'],
}

const MARK_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'array', items: { type: 'integer' }, description: '1-based numbers of tasks the user finished' },
    undone: { type: 'array', items: { type: 'integer' }, description: '1-based numbers of tasks to reopen' },
    clear: { type: 'boolean', description: 'True to remove the whole list (the work is over or abandoned)' },
  },
}

// Set once this plugin's band hook runs. Another plugin that draws the band without passing it
// on (or a surface with no band) leaves it false, and the list goes to a pane instead.
let isBandSeen = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'set_user_tasks',
      description: 'Pins the steps the user must do themselves in a panel above their prompt, replacing any previous list. Call it whenever your reply gives the user a multi-step list of actions to perform. Only steps the user performs themselves; never your own work plan (that is TodoWrite) or optional suggestions.',
      inputSchema: TASK_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'mark_user_tasks',
      description: 'Marks steps of the pinned user task list as done or not done (1-based numbers), or clears the list. Call it when the user says they finished, skipped or undid steps.',
      inputSchema: MARK_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({
      name: 'todo',
      description: 'User task panel: toggle the full list, or done/undo <n>, scan, pane, close, show, hide, clear',
      argumentHint: '[done [n] | undo <n> | scan | pane | close | show | hide | clear]',
      immediate: true,
    })
    await syncStatus($)

    return next(e)
  })

  on('tool.call', { tool: SET_TOOL }, async ($, e) => {
    const parsed = parseTasks(e as unknown as Record<string, unknown>)

    if (parsed === undefined) {
      return { result: 'No task had text; nothing was pinned.' }
    }

    await pin($, parsed, false)

    return { result: `Pinned. ${describe(parsed)}` }
  })

  on('tool.call', { tool: MARK_TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>

    if (input.clear === true) {
      await changeList($, () => null)
      return { result: 'The task list was cleared.' }
    }

    let isChanged = false
    const changed = await changeList($, l => {
      if (l === null) {
        return l
      }

      const done = toIndexes(input.done, l.tasks.length)
      const undone = toIndexes(input.undone, l.tasks.length)
      isChanged = done.length + undone.length > 0

      return isChanged ? markTasks(markTasks(l, done, true), undone, false) : l
    })

    if (changed === null) {
      return { result: 'No task list is pinned.' }
    }

    return { result: isChanged ? describe(changed) : `No valid task number; nothing changed.\n${describe(changed)}` }
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const current = await read($, list)

    if (verb === 'scan') {
      const found = await scan($)

      if (found.list !== undefined) {
        await pin($, found.list, true)
      }

      return found.answer
    }

    if (verb === 'clear') {
      await changeList($, () => null)
      return { text: '할 일 목록을 지웠습니다.' }
    }

    if (verb === 'close') {
      await closePane($)
      return { text: '할 일 패널을 닫았습니다. /todo 로 다시 엽니다.' }
    }

    if (verb === 'hide') {
      await update($, isHidden, () => true)
      await syncStatus($)
      return { text: '할 일 패널을 숨겼습니다. /todo show 로 다시 엽니다.' }
    }

    if (current === null) {
      return { text: '고정된 할 일이 없습니다. /todo scan 으로 최근 응답에서 찾아볼 수 있습니다.' }
    }

    if (verb === 'done' || verb === 'undo') {
      const isDone = verb === 'done'
      const fallback = isDone ? nextIndex(current) + 1 : undefined
      const numbers = rest.length > 0 ? rest : fallback ? [fallback] : []
      const indexes = toIndexes(numbers, current.tasks.length)

      if (indexes.length === 0) {
        return { text: isDone ? '완료할 항목이 없습니다.' : '사용법: /todo undo <번호>' }
      }

      const changed = await changeList($, l => (l === null ? l : markTasks(l, toIndexes(numbers, l.tasks.length), isDone)))

      if (changed === null) {
        return { text: '고정된 할 일이 없습니다.' }
      }

      const label = indexes.map(i => i + 1).join(', ')

      return {
        text: `${label}번을 ${isDone ? '완료' : '미완료'}로 표시했습니다.`,
        context: [`The user marked tasks ${label} of the pinned list as ${isDone ? 'done' : 'not done'}.\n${describe(changed)}`],
      }
    }

    await update($, isHidden, () => false)
    await syncStatus($)

    if (verb === 'pane' || !isBandSeen) {
      await openPane($, true)
      return { text: '할 일 패널을 열었습니다.' }
    }

    if (verb === 'show') {
      await update($, isExpanded, () => true)
      return { text: '할 일 패널을 펼쳤습니다.' }
    }

    const isNowExpanded = await update($, isExpanded, open => !open)

    return { text: isNowExpanded ? '전체 할 일을 펼쳤습니다.' : '다음 할 일만 보여줍니다.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    isBandSeen = true
    const current = await read($, list)

    if (e.props.hasSurvey || current === null || (await read($, isHidden))) {
      return next(e)
    }

    const expanded = await read($, isExpanded)
    const below = await next(e)
    const elements = $.ui.resolve(e) as unknown as ListElements
    const { Box } = elements

    // Whatever the plugins beneath draw in the band stays, under the list. The engine refuses its
    // own node under a Box given a width, so the width goes on the list alone.
    return (
      <Box flexDirection="column">
        <Box key="sized" width={Math.max(20, e.props.bodyColumns)}>
          {drawList($, elements, current, { expanded, canExpand: true, canClose: false })}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, list)
    const elements = $.ui.resolve(e) as unknown as ListElements
    const { Box, Button, Text } = elements

    if (current === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>고정된 할 일이 없습니다. /todo scan 으로 최근 응답에서 찾아볼 수 있습니다.</Text>
          <Button key="close" hotkey="q" role="dismiss" label="닫기" onPress={() => closePane($)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={Math.max(20, e.props.bodyColumns)}>
        {drawList($, elements, current, { expanded: true, canExpand: false, canClose: true })}
      </Box>
    )
  })
}

type ListElements = Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>

type DrawOptions = { expanded: boolean; canExpand: boolean; canClose: boolean }

// The list as the band and the pane draw it: the next task, or every task when expanded.
function drawList($: EngineInterface, { Box, Button, Text }: ListElements, current: TaskList, options: DrawOptions) {
  const { expanded, canExpand, canClose } = options
  const next_ = nextIndex(current)
  const total = current.tasks.length

  const toggle = (i: number) => changeList($, l => (l === null ? l : markTasks(l, [i], !l.tasks[i]?.isDone)))
  // The next task is read again at press time, so two quick presses finish two tasks.
  const finishNext = () =>
    changeList($, l => {
      const i = l === null ? -1 : nextIndex(l)
      return l === null || i === -1 ? l : markTasks(l, [i], true)
    })
  const hide = async () => {
    await update($, isHidden, () => true)
    await syncStatus($)
  }

  const header = (
    <Box key="header">
      <Text wrap="truncate-end">
        <Text color="claude" bold>{next_ === -1 ? '✅ 할 일 완료' : '📋 다음 할 일'}</Text>
        <Text dimColor> {doneCount(current)}/{total} · {current.title}</Text>
      </Text>
    </Box>
  )

  const controls = (
    <Box key="controls" flexDirection="row" gap={1}>
      {next_ !== -1 && <Button key="done" hotkey="d" label="✓ 완료" onPress={finishNext} />}
      {canExpand && <Button key="expand" hotkey="a" label={expanded ? '접기' : `전체 (${total})`} onPress={() => update($, isExpanded, open => !open)} />}
      {next_ === -1 && <Button key="clear" hotkey="c" label="지우기" onPress={() => changeList($, () => null)} />}
      {canExpand && <Button key="hide" hotkey="h" label="숨기기" onPress={hide} />}
      {canClose && <Button key="close" hotkey="q" role="dismiss" label="닫기" onPress={() => closePane($)} />}
    </Box>
  )

  if (!expanded) {
    const task = next_ === -1 ? undefined : current.tasks[next_]

    return (
      <Box key="list" flexDirection="column">
        {header}
        {task !== undefined && (
          <Box key="next">
            <Text>
              <Text bold>{next_ + 1}. </Text>
              {task.group && <Text dimColor>[{task.group}] </Text>}
              {task.text}
            </Text>
          </Box>
        )}
        {controls}
      </Box>
    )
  }

  const rows: JSX.Element[] = []
  let group: string | undefined

  current.tasks.forEach((task, i) => {
    if (task.group !== undefined && task.group !== group) {
      rows.push(<Box key={`g${i}`}><Text bold dimColor>{task.group}</Text></Box>)
    }

    group = task.group
    const mark = task.isDone ? '✓' : i === next_ ? '▶' : '○'

    rows.push(
      <Button key={`t${i}`} plain onPress={() => toggle(i)}>
        <Text color={i === next_ ? 'claude' : undefined} dimColor={task.isDone} strikethrough={task.isDone}>
          {mark} {i + 1}. {task.text}
        </Text>
      </Button>,
    )
  })

  return (
    <Box key="list" flexDirection="column">
      {header}
      {rows}
      {controls}
    </Box>
  )
}

// Writes the list and keeps the status line, which no other plugin can cover, in step with it.
async function changeList($: EngineInterface, change: (value: TaskList | null) => TaskList | null) {
  const value = await update($, list, change)
  await syncStatus($)
  return value
}

async function pin($: EngineInterface, parsed: TaskList, isAsked: boolean) {
  await update($, isHidden, () => false)
  await update($, isExpanded, () => false)
  await changeList($, () => parsed)
  await openPane($, isAsked)
}

// Opens the pane where the band cannot show the list, or where the person asked for it.
async function openPane($: EngineInterface, isAsked: boolean) {
  if (isBandSeen && !isAsked) {
    return
  }

  try {
    await $.ui.open({ id: PANE, title: '할 일' })
  } catch {
    // No surface takes panes here; the status line still shows the next task.
  }
}

async function closePane($: EngineInterface) {
  try {
    await $.ui.close({ id: PANE })
  } catch {
    // Already closed.
  }
}

// The status line under the prompt: the next task, kept beside the engine's own notices.
async function syncStatus($: EngineInterface) {
  const text = statusLine(await read($, list), await read($, isHidden))

  try {
    $.ui.status(text)
  } catch {
    // A session with no surface keeps no status line.
  }
}

// Asks a fork of this conversation for the user's open steps, for a list the model never pinned.
async function scan($: EngineInterface): Promise<{ answer: { text: string; context?: string[] }; list?: TaskList }> {
  const reply = await $.model.fork({
    prompt: 'Look at your recent replies in this conversation. List the steps you asked the USER to perform themselves (not your own work), in order, from the most recent such list. Answer with JSON only: {"title": string, "tasks": [{"text": string, "group"?: string, "done"?: boolean}]}, written in the user\'s language, "done": true for steps the user has already said they finished. Answer {"tasks": []} when there are none.',
  })

  if (!reply.isAnswered) {
    return { answer: { text: `할 일을 찾지 못했습니다 (${reply.reason}).` } }
  }

  const parsed = parseTasks(parseJsonObject(reply.text) ?? {})

  if (parsed === undefined) {
    return { answer: { text: '최근 응답에서 사용자가 할 일을 찾지 못했습니다.' } }
  }

  const next = nextIndex(parsed)
  const nextText = next === -1 ? '모두 완료' : `다음: ${next + 1}. ${parsed.tasks[next]?.text}`

  return {
    answer: {
      text: `할 일 ${parsed.tasks.length}개를 고정했습니다. ${nextText}`,
      context: [`The user pinned a task list found in your replies.\n${describe(parsed)}`],
    },
    list: parsed,
  }
}
