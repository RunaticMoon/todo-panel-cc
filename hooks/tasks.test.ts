import { expect, test } from 'claude-code/testing'

import { parseJsonObject, parseTasks, preserveProgress, statusLine, toIndexes } from './tasks'

test('toIndexes takes numbers and digit strings only', async () => {
  expect(toIndexes([1, '2', true, null, 0, 9, 1.5, ' 3 '], 3)).toEqual([0, 1, 2])
  expect(toIndexes(2, 3)).toEqual([1])
  expect(toIndexes(undefined, 3)).toEqual([])
})

test('parseTasks drops empty steps and keeps groups', async () => {
  expect(parseTasks({ tasks: [{ text: ' ' }] })).toBeUndefined()
  expect(parseTasks({ tasks: ['a', { text: 'b', group: 'g', done: true }] })).toEqual({
    title: '할 일',
    tasks: [{ text: 'a', group: undefined, isDone: false }, { text: 'b', group: 'g', isDone: true }],
  })
})

test('parseJsonObject finds the object among prose and fences', async () => {
  expect(parseJsonObject('Here: {"tasks": ["a"]} and {not json}')).toEqual({ tasks: ['a'] })
  expect(parseJsonObject('note {x}\n```json\n{"tasks": [{"text": "a } b"}]}\n```')).toEqual({ tasks: [{ text: 'a } b' }] })
  expect(parseJsonObject('nothing here')).toBeUndefined()
})

test('statusLine names the next task, or says all are done', async () => {
  const list = parseTasks({ tasks: ['a', 'b'] })!
  expect(statusLine(list, false)).toBe('📋 다음 할 일 1/2: a')
  expect(statusLine(list, true)).toBeUndefined()
  expect(statusLine(null, false)).toBeUndefined()
  expect(statusLine({ ...list, tasks: list.tasks.map(t => ({ ...t, isDone: true })) }, false)).toContain('2/2 완료')
})

test('scan preserves progress only for a complete ordered match, including groups', () => {
  const current = parseTasks({ title: 'old', tasks: [{ text: 'a', group: 'g', done: true }, { text: 'a', group: 'h' }] })!
  const renamed = parseTasks({ title: 'new', tasks: [{ text: 'a', group: 'g' }, { text: 'a', group: 'h', done: true }] })!
  expect(preserveProgress(current, renamed)).toEqual({ ...renamed, tasks: current.tasks })

  for (const scanned of [
    parseTasks({ tasks: ['a'] })!,
    parseTasks({ tasks: ['a', 'a'] })!,
    parseTasks({ tasks: [{ text: 'changed', group: 'g' }, { text: 'a', group: 'h' }] })!,
    { ...renamed, tasks: [...renamed.tasks].reverse() },
    { ...renamed, tasks: [...renamed.tasks, { text: 'new', isDone: false }] },
  ]) {
    expect(preserveProgress(current, scanned)).toEqual(scanned)
  }
  expect(preserveProgress(null, renamed)).toEqual(renamed)
})
