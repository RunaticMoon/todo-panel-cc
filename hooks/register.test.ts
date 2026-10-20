import type { On, RenderElement } from 'claude-code'
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

  register(fakeOn)

  const guarded = ['prompt.compose', 'prompt.section', 'prompt.context', 'prompt.attachment', 'session.append']
  expect(events.filter(name => guarded.includes(name) || name.startsWith('classic.'))).toEqual([])
  for (const name of ['session.start', 'tool.call', 'command.run', 'ui.render']) {
    expect(events).toContain(name)
  }
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
