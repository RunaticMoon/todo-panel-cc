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

test('parseJsonObject reads a bare JSON reply whose strings contain fences', async () => {
  const payload = {
    title: '설정 파일 준비',
    tasks: [
      { text: 'config.json 파일에 다음 내용을 저장하세요:\n```json\n{}\n```' },
      { text: '설정 파일을 저장한 다음 프로그램을 다시 실행하세요.' },
    ],
  }
  const reply = JSON.stringify(payload)
  const parsed = parseJsonObject(reply)

  expect(parsed).toEqual(payload)
  expect(parseJsonObject(`  ${reply}\n`)).toEqual(payload)
  expect(parseTasks(parsed ?? {})?.tasks.length).toBe(2)
  expect(parseTasks(parsed ?? {})?.tasks.map(task => task.text)).toEqual(payload.tasks.map(task => task.text))
  expect(parseJsonObject('{"tasks": []}')).toEqual({ tasks: [] })
})

test('parseJsonObject preserves fences, braces and escaped quotes in values', async () => {
  const payload = {
    title: '제목 "인용" ```json\n{}\n```',
    tasks: [{
      group: '그룹 {중괄호} "인용" ```json\n{}\n```',
      text: 'config.json 파일에 다음 내용을 저장하세요:\n```json\n{"key": "value"}\n``` 그리고 "따옴표"',
    }],
  }
  const parsed = parseJsonObject(JSON.stringify(payload))

  expect(parsed).toEqual(payload)
  expect(parseTasks(parsed ?? {})?.title).toBe(payload.title)
  expect(parseTasks(parsed ?? {})?.tasks[0]?.text).toBe(payload.tasks[0].text)
  expect(parseTasks(parsed ?? {})?.tasks[0]?.group).toBe(payload.tasks[0].group)
})

test('parseJsonObject reads a real outer fence, even one around an inner fence', async () => {
  const payload = { title: 'outer', tasks: [{ text: 'run:\n```json\n{}\n```' }] }

  expect(parseJsonObject(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``)).toEqual(payload)
  expect(parseJsonObject('```json\n{"tasks": ["a"]}\n```')).toEqual({ tasks: ['a'] })
})

test('parseJsonObject reads a fence that begins where a raw object ends', async () => {
  expect(parseJsonObject('{"tasks":["a"]}```json\n{"tasks":["b"]}\n```')).toEqual({ tasks: ['b'] })
})

test('parseJsonObject prefers the outer object when a fence closes the regex early', async () => {
  const payload = {
    title: 'outer fence',
    tasks: [
      { text: 'first step' },
      { text: 'save:\n```json\n{}\n```' },
      { text: 'third' },
    ],
  }
  const fenced = `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``

  expect(parseJsonObject(fenced)).toEqual(payload)
  expect(parseTasks(parseJsonObject(fenced) ?? {})?.tasks.length).toBe(3)
})

test('parseJsonObject prefers the outer object when prose wraps that fence', async () => {
  const payload = {
    title: 'outer fence',
    tasks: [
      { text: 'first step' },
      { text: 'save:\n```json\n{}\n```' },
      { text: 'third' },
    ],
  }
  const fenced = `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
  const prose = `Here are the steps:\n${fenced}\nDone.`

  expect(parseJsonObject(prose)).toEqual(payload)
  expect(parseTasks(parseJsonObject(prose) ?? {})?.tasks.map(task => task.text)).toEqual(payload.tasks.map(task => task.text))
  expect(parseTasks(parseJsonObject(prose) ?? {})?.tasks.length).toBe(3)
})

test('parseJsonObject reads bare and fenced objects wrapped in prose', async () => {
  const payload = { title: '설정 파일 준비', tasks: [{ text: 'save:\n```json\n{}\n```' }] }
  const json = JSON.stringify(payload)

  expect(parseJsonObject(`Here are the steps:\n${json}\nDone.`)).toEqual(payload)
  expect(parseJsonObject(`Here are the steps:\n\`\`\`json\n${json}\n\`\`\`\nDone.`)).toEqual(payload)
})

test('parseJsonObject still rejects replies with no JSON object', async () => {
  expect(parseJsonObject('{not json}')).toBeUndefined()
  expect(parseJsonObject('```json\n{not json}\n```')).toBeUndefined()
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
