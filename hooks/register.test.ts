import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'

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

test('/todo done and undo change the list', async $ => {
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

test('the guidance is one static session section at the end', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' }] }))
  const before = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  await $.tool.call({ tool: 'mcp__todo-panel__set_user_tasks', ...TASKS })
  const after = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  const last = after.sections[after.sections.length - 1]

  expect(last?.id).toBe('todo-panel:guidance')
  expect(last?.scope).toBe('session')
  expect(after.sections[0]?.id).toBe('intro')
  expect(after.sections).toEqual(before.sections)
})
