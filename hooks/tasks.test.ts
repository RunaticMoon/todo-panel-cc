import { expect, test } from 'claude-code/testing'

import { parseJsonObject, parseTasks, toIndexes } from './tasks'

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
