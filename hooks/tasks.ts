import type { TaskList, UserTask } from '../types'

// Turns the model's tool input into a list; undefined when it holds no task.
export function parseTasks(input: Record<string, unknown>): TaskList | undefined {
  const raw = Array.isArray(input.tasks) ? input.tasks : []
  const tasks: UserTask[] = []

  for (const item of raw) {
    const one = typeof item === 'string' ? { text: item } : (item as Record<string, unknown>)
    const text = typeof one?.text === 'string' ? one.text.trim() : ''

    if (text === '') {
      continue
    }

    const group = typeof one.group === 'string' && one.group.trim() !== '' ? one.group.trim() : undefined
    tasks.push({ text, group, isDone: one.done === true })
  }

  if (tasks.length === 0) {
    return undefined
  }

  const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : '할 일'

  return { title, tasks }
}

// 1-based numbers as the model and the person count them; out of range ones dropped.
export function toIndexes(value: unknown, length: number): number[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]

  // Numbers, or digit strings as typed after /todo; anything else (a boolean, null) is no task.
  const numbers = list.map(n => (typeof n === 'string' && /^\d+$/.test(n.trim()) ? Number(n) : n))
  const indexes = numbers
    .filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
    .map(n => n - 1)
    .filter(i => i >= 0 && i < length)

  return [...new Set(indexes)]
}

export function markTasks(list: TaskList, indexes: number[], isDone: boolean): TaskList {
  return {
    ...list,
    tasks: list.tasks.map((task, i) => (indexes.includes(i) ? { ...task, isDone } : task)),
  }
}

// With no stable IDs, only a complete ordered match is safe to reuse. A renamed
// heading still describes the same steps; never guess matches for changed steps.
export function preserveProgress(current: TaskList | null, scanned: TaskList): TaskList {
  if (current === null || current.tasks.length !== scanned.tasks.length ||
    !current.tasks.every((task, i) => task.text === scanned.tasks[i]?.text && task.group === scanned.tasks[i]?.group)) {
    return scanned
  }

  return { ...scanned, tasks: current.tasks }
}

export function nextIndex(list: TaskList): number {
  return list.tasks.findIndex(task => !task.isDone)
}

export function doneCount(list: TaskList): number {
  return list.tasks.filter(task => task.isDone).length
}

// One line for the status line under the prompt; undefined clears it.
export function statusLine(list: TaskList | null, isHidden: boolean): string | undefined {
  if (list === null || isHidden) {
    return undefined
  }

  const next = nextIndex(list)
  const total = list.tasks.length

  if (next === -1) {
    return `✅ 할 일 ${total}/${total} 완료 · /todo clear`
  }

  const text = list.tasks[next]?.text.replace(/\s+/g, ' ') ?? ''
  const short = text.length > 100 ? `${text.slice(0, 99)}…` : text

  return `📋 다음 할 일 ${next + 1}/${total}: ${short}`
}

// The list as the model reads it back after each change.
export function describe(list: TaskList): string {
  const next = nextIndex(list)
  const lines = list.tasks.map((task, i) => `${i + 1}. [${task.isDone ? 'x' : ' '}] ${task.group ? `(${task.group}) ` : ''}${task.text}`)
  const head = next === -1
    ? `All ${list.tasks.length} tasks of "${list.title}" are done.`
    : `"${list.title}": ${doneCount(list)}/${list.tasks.length} done; the panel shows task ${next + 1} as next.`

  return [head, ...lines].join('\n')
}

// Pulls the first JSON object out of a model reply that may wrap it in prose or a fence.
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]

  for (const source of fenced === undefined ? [text] : [fenced, text]) {
    for (let start = source.indexOf('{'); start !== -1; start = source.indexOf('{', start + 1)) {
      const value = parseBalanced(source, start)

      if (value !== undefined) {
        return value
      }
    }
  }

  return undefined
}

// Parses the object that opens at `start`, its end found by counting braces outside strings.
function parseBalanced(source: string, start: number): Record<string, unknown> | undefined {
  let depth = 0
  let isInString = false

  for (let i = start; i < source.length; i += 1) {
    const char = source[i]

    if (isInString) {
      if (char === '\\') i += 1
      else if (char === '"') isInString = false
    } else if (char === '"') {
      isInString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}' && --depth === 0) {
      try {
        const value: unknown = JSON.parse(source.slice(start, i + 1))
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
      } catch {
        return undefined
      }
    }
  }

  return undefined
}
