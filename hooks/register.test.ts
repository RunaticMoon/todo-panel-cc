import type { ModelForkResult, On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { register } from './register'

// Stands for the engine's own empty band beneath the plugin.
const engineBand = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine' }) as RenderElement
  })

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const TASKS = {
  title: 'PR 리뷰와 머지',
  tasks: [
    { group: '1. PR 리뷰와 머지', text: '#49를 Ready로 바꾸고 리뷰어를 지정합니다.' },
    { group: '1. PR 리뷰와 머지', text: '#100을 리뷰받고 master에 머지합니다.' },
    { group: '2. 첫 sync 전 확인', text: 'ArgoCD UI에서 diff를 확인합니다.' },
  ],
}

const todo = (args: string) => ({
  command: 'todo',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 100 },
})

const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answered = (text: string): ModelForkResult => ({ isAnswered: true, text, usage: ZERO_USAGE })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('pinned tasks show the next one and advance as they are done', async ($, on) => {
  engineBand(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
    const ui = await $.ui.mount({ plugin: 'todo-panel', surface, ...BAND })

    expect((await ui.find({ key: 'next' }))?.text).toMatch(/1\. .*#49를 Ready/)
    expect(await ui.find({ type: 'Text', text: /#100을/ })).toBeUndefined()

    await ui.press({ key: 'done' })
    expect((await ui.find({ key: 'next' }))?.text).toMatch(/2\. .*#100을/)

    await ui.press({ key: 'expand' })
    expect(await ui.find({ key: 't2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2. 첫 sync 전 확인' })).toBeDefined()
    await ui.press({ key: 'expand' })

    await ui.press({ key: 'hide' })
    expect(await ui.find({ key: 'header' })).toBeUndefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
  }
})

test('the model marks tasks by number and the list clears', async ($, on) => {
  engineBand(on)
  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
  const marked = await $.tool.call({ tool: 'mcp__todo-panel__mark_user_tasks', done: [1, 2] })
  expect(String(marked.result)).toContain('task 3 as next')

  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'next' }))?.text).toMatch(/3\. .*ArgoCD/)

  await $.tool.call({ tool: 'mcp__todo-panel__mark_user_tasks', done: [3] })
  expect((await ui.find({ key: 'header' }))?.text).toContain('3/3')
  expect(await ui.find({ key: 'clear' })).toBeDefined()

  await $.tool.call({ tool: 'mcp__todo-panel__mark_user_tasks', clear: true })
  expect(await ui.find({ key: 'header' })).toBeUndefined()
  await ui.unmount()
})

test('/todo done and undo change the list', async ($, on) => {
  engineBand(on)
  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
  const done = await $.command.run({ command: 'todo', args: 'done', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  expect(done.text).toContain('1번')

  const undo = await $.command.run({ command: 'todo', args: 'undo 1', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  expect(undo.text).toContain('미완료')

  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'next' }))?.text).toMatch(/1\. /)
  await ui.unmount()
})

test('two quick presses of done finish two tasks', async ($, on) => {
  engineBand(on)
  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })

  await Promise.all([ui.press({ key: 'done' }), ui.press({ key: 'done' })])
  expect((await ui.find({ key: 'header' }))?.text).toContain('2/3')
  await ui.unmount()
})

test('mark ignores numbers that name no task', async $ => {
  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })

  for (const done of [true, [true], [0], [99], []]) {
    const marked = await $.tool.call({ tool: 'mcp__todo-panel__mark_user_tasks', done })
    expect(String(marked.result)).toContain('nothing changed')
    expect(String(marked.result)).toContain('0/3 done')
  }

  const undone = await $.tool.call({ tool: 'mcp__todo-panel__mark_user_tasks', done: [1, 1, 2], undone: [2] })
  expect(String(undone.result)).toContain('1/3 done')
})

test('the register adds no prompt-modifying hooks', () => {
  const events: string[] = []
  const fakeOn = ((event: string) => {
    events.push(event)
  }) as unknown as On

  register(fakeOn, {})

  const guarded = ['prompt.compose', 'prompt.section', 'prompt.context', 'prompt.attachment', 'session.append']
  expect(events.filter(name => guarded.includes(name) || name.startsWith('classic.'))).toEqual([])
  for (const name of ['session.start', 'tool.call', 'command.run', 'ui.render']) {
    expect(events).toContain(name)
  }
})

test('session start migrates legacy progress and display settings only once', async ($, on) => {
  engineBand(on)
  const legacyList = {
    ...TASKS,
    tasks: TASKS.tasks.map((task, i) => ({ ...task, isDone: i === 0 })),
  }
  const statuses: (string | undefined)[] = []
  on('state.get', { plugin: 'todo-panel', key: 'list' }, () => ({ value: { value: legacyList, version: 1 } }))
  on('state.get', { plugin: 'todo-panel', key: 'isHidden' }, () => ({ value: { value: true, version: 1 } }))
  on('state.get', { plugin: 'todo-panel', key: 'isExpanded' }, () => ({ value: { value: true, version: 1 } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__todo-panel__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const session = { cwd: '/tmp/todo-panel-test', surface: 'terminal' as const, isInteractive: true }

  await $.session.start(session)
  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'header' })).toBeUndefined()
  expect(statuses[statuses.length - 1]).toBeUndefined()

  // Showing the hidden band toggles the migrated expanded state back to collapsed.
  await $.command.run(todo(''))
  expect((await ui.find({ key: 'header' }))?.text).toContain('1/3')
  expect((await ui.find({ key: 'next' }))?.text).toMatch(/2\. .*#100을/)
  expect(await ui.find({ key: 't2' })).toBeUndefined()

  await $.command.run(todo('done 2'))
  await $.session.start(session)
  expect((await ui.find({ key: 'header' }))?.text).toContain('2/3')
  expect((await ui.find({ key: 'next' }))?.text).toMatch(/3\. .*ArgoCD/)
  expect(statuses[statuses.length - 1]).toContain('다음 할 일 3/3')

  await $.command.run(todo('clear'))
  await $.session.start(session)
  expect(await ui.find({ key: 'header' })).toBeUndefined()
  expect(statuses[statuses.length - 1]).toBeUndefined()
  await ui.unmount()
})

test('a band another plugin holds sends the list to a pane and the status line', async ($, on) => {
  const opened: string[] = []
  const statuses: (string | undefined)[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
  expect(opened).toEqual(['todo-panel'])
  expect(statuses[statuses.length - 1]).toContain('다음 할 일 1/3: #49를 Ready로')

  const pane = await $.ui.mount({
    plugin: 'todo-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'todo-panel',
    props: { title: '할 일', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ key: 't2' })).toBeDefined()
  await pane.press({ key: 'done' })
  expect(statuses[statuses.length - 1]).toContain('다음 할 일 2/3')
  await pane.unmount()
})

test('the band keeps what the plugins beneath draw', async ($, on) => {
  engineBand(on)
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })

  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })

  expect(await ui.find({ key: 'header' })).toBeDefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(opened).toEqual([])
  await ui.unmount()
})

test('the pane closes from its own button and from /todo close', async ($, on) => {
  const closed: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })

  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
  const pane = await $.ui.mount({
    plugin: 'todo-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'todo-panel',
    props: { title: '할 일', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  await pane.press({ key: 'close' })
  expect(closed).toEqual(['todo-panel'])
  await pane.unmount()

  const answer = await $.command.run({ command: 'todo', args: 'close', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  expect(answer.text).toContain('닫았습니다')
  expect(closed).toEqual(['todo-panel', 'todo-panel'])
})

test('scan pins a list and preserves local done and undone states in the panel and answer', async ($, on) => {
  engineBand(on)
  const opened: string[] = []
  const statuses: (string | undefined)[] = []
  let reply = JSON.stringify(TASKS)
  on('model.fork', () => ({ value: answered(reply) }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  const first = await $.command.run(todo('scan'))
  expect(first.text).toContain('할 일 3개를 고정했습니다. 다음: 1.')
  expect(opened).toEqual(['todo-panel'])
  expect((await ui.find({ key: 'header' }))?.text).toContain('0/3')

  await ui.press({ key: 'done' })
  await $.command.run(todo('done 2'))
  await $.command.run(todo('undo 2'))
  reply = JSON.stringify({
    ...TASKS,
    title: '다시 찾은 목록',
    tasks: TASKS.tasks.map((task, i) => i === 1 ? { ...task, done: true } : task),
  })

  const preserved = await $.command.run(todo('scan'))
  expect((await ui.find({ key: 'header' }))?.text).toContain('1/3')
  expect((await ui.find({ key: 'header' }))?.text).toContain('다시 찾은 목록')
  expect((await ui.find({ key: 'next' }))?.text).toMatch(/2\. .*#100을/)
  expect(preserved.text).toContain('다음: 2. #100을')
  const context = preserved.context?.join('\n') ?? ''
  expect(context).toContain('1/3 done; the panel shows task 2 as next.')
  expect(context).toContain('1. [x] (1. PR 리뷰와 머지) #49를 Ready')
  expect(context).toContain('2. [ ] (1. PR 리뷰와 머지) #100을')
  expect(statuses[statuses.length - 1]).toContain('다음 할 일 2/3: #100을')
  expect(opened).toEqual(['todo-panel', 'todo-panel'])
  await ui.unmount()
})

test('scan discards replies after local changes, clearing, replacement, or an ABA change', async ($, on) => {
  engineBand(on)
  let started = deferred<void>()
  let reply = deferred<string>()
  const opened: string[] = []
  on('model.fork', async () => {
    started.resolve()
    return { value: answered(await reply.promise) }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })

  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  for (const change of ['done', 'undo', 'clear', 'replace', 'aba', 'empty-clear'] as const) {
    await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
    if (change === 'undo') await $.command.run(todo('done 1'))
    if (change === 'empty-clear') await $.command.run(todo('clear'))
    started = deferred<void>()
    reply = deferred<string>()
    opened.length = 0

    const pending = $.command.run(todo('scan'))
    await started.promise
    if (change === 'done') await ui.press({ key: 'done' })
    else if (change === 'undo') await $.command.run(todo('undo 1'))
    else if (change === 'replace') {
      await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', title: '새 작업', tasks: [{ text: '새 작업을 진행합니다.' }] })
    } else {
      await $.command.run(todo('clear'))
      if (change === 'aba') await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
    }
    reply.resolve(JSON.stringify({ ...TASKS, title: '오래된 스캔 결과' }))
    const answer = await pending

    expect(answer.text).not.toContain('고정했습니다')
    expect(answer.text).toContain('다시')
    expect(answer.context ?? []).toEqual([])
    expect(opened).toEqual([])
    const header = await ui.find({ key: 'header' })
    if (change === 'clear' || change === 'empty-clear') expect(header).toBeUndefined()
    else if (change === 'replace') {
      expect(header?.text).toContain('새 작업')
      expect((await ui.find({ key: 'next' }))?.text).toContain('새 작업을 진행합니다.')
    } else {
      expect(header?.text).toContain(change === 'done' ? '1/3' : '0/3')
      expect(header?.text).toContain(TASKS.title)
    }
  }
  await ui.unmount()
})

test('a discarded scan preserves the hidden and expanded panel without opening a pane', async ($, on) => {
  engineBand(on)
  const started = deferred<void>()
  const reply = deferred<string>()
  const opened: string[] = []
  on('model.fork', async () => {
    started.resolve()
    return { value: answered(await reply.promise) }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
  await ui.press({ key: 'expand' })

  const pending = $.command.run(todo('scan'))
  await started.promise
  await ui.press({ key: 't0' })
  await ui.press({ key: 'hide' })
  reply.resolve(JSON.stringify(TASKS))
  const answer = await pending

  expect(answer.text).not.toContain('고정했습니다')
  expect(await ui.find({ key: 'header' })).toBeUndefined()
  expect(opened).toEqual([])
  // A plain /todo shows the band and toggles the retained expanded state back to collapsed.
  await $.command.run(todo(''))
  expect((await ui.find({ key: 'header' }))?.text).toContain('1/3')
  expect((await ui.find({ key: 'next' }))?.text).toMatch(/2\. .*#100을/)
  expect(await ui.find({ key: 't2' })).toBeUndefined()
  await ui.unmount()
})

test('only the latest scan may apply, even when it finds no list or fails', async ($, on) => {
  engineBand(on)
  let started = [deferred<void>(), deferred<void>()]
  let replies = [deferred<ModelForkResult>(), deferred<ModelForkResult>()]
  let calls = 0
  const opened: string[] = []
  on('model.fork', async () => {
    const i = calls++
    started[i]!.resolve()
    return { value: await replies[i]!.promise }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })

  const ui = await $.ui.mount({ plugin: 'todo-panel', surface: 'terminal', ...BAND })
  for (const latestResult of ['list', 'empty', 'failure'] as const) {
    const hasLatestList = latestResult === 'list'
    await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
    started = [deferred<void>(), deferred<void>()]
    replies = [deferred<ModelForkResult>(), deferred<ModelForkResult>()]
    calls = 0
    opened.length = 0
    const older = $.command.run(todo('scan'))
    await started[0]!.promise
    const latest = $.command.run(todo('scan'))
    await started[1]!.promise

    replies[1]!.resolve(latestResult === 'failure'
      ? { isAnswered: false, reason: 'api-error', status: 503, error: 'server_error', usage: ZERO_USAGE }
      : answered(JSON.stringify(hasLatestList ? { title: '최신 스캔', tasks: [{ text: '최신 작업입니다.' }] } : { tasks: [] })))
    const newestAnswer = await latest
    expect(newestAnswer.text?.includes('고정했습니다')).toBe(hasLatestList)
    if (latestResult === 'failure') expect(newestAnswer.text).toContain('api-error')
    replies[0]!.resolve(answered(JSON.stringify({ title: '이전 스캔', tasks: [{ text: '오래된 작업입니다.' }] })))
    const discarded = await older

    expect(discarded.text).not.toContain('고정했습니다')
    expect(discarded.context ?? []).toEqual([])
    expect((await ui.find({ key: 'header' }))?.text).toContain(hasLatestList ? '최신 스캔' : TASKS.title)
    expect((await ui.find({ key: 'next' }))?.text).toContain(hasLatestList ? '최신 작업입니다.' : '#49를 Ready')
    expect(opened).toEqual(hasLatestList ? ['todo-panel'] : [])
  }
  await ui.unmount()
})
