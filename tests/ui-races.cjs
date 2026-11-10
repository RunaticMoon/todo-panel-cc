// Dependency-light regression harness for the source hooks. This is not a host UI test.
// Run: node tests/ui-races.cjs /path/to/typescript
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.resolve(__dirname, '..')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function runtime() {
  let state, version = 0, gate, retry
  const hooks = [], statuses = []
  const api = {
    atom: (_, initial) => { state = initial; return {} },
    read: async () => { const snapshot = state; if (gate) { const g = gate; gate = null; g.reached.resolve(); await g.release.promise } return snapshot },
    update: async (_, atom, change) => {
      for (;;) {
        const v = version, next = change(state)
        if (retry) { const r = retry; retry = null; r() }
        await Promise.resolve()
        if (v !== version) continue
        if (next !== state) { state = next; version++ }
        return state
      }
    },
  }
  const cache = {}
  function load(file) {
    if (cache[file]) return cache[file].exports
    const mod = cache[file] = { exports: {} }
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' }, fileName: file, reportDiagnostics: true })
    assert.deepEqual(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [])
    const localRequire = name => name === 'claude-code' ? api : load(path.resolve(path.dirname(file), name + '.ts'))
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
    vm.runInNewContext('(function(require,module,exports,h){' + output.outputText + '\n})', {})(localRequire, mod, mod.exports, h)
    return mod.exports
  }
  const { register } = load(path.join(root, 'hooks/register.tsx'))
  register((name, filter, fn) => hooks.push({ name, filter: typeof filter === 'function' ? {} : filter, fn: fn || filter }))
  const $ = { ui: { status: text => statuses.push(text), open: async () => {}, close: async () => {}, resolve: () => ({ Box: 'Box', Button: 'Button', Text: 'Text' }) } }
  const emit = (name, event) => hooks.find(h => h.name === name && Object.entries(h.filter).every(([k,v]) => event[k] === v)).fn($, event, async () => null)
  const set = (texts = ['A', 'B', 'C']) => emit('tool.call', { tool: 'mcp__todo-panel__set_user_tasks', tasks: texts.map(text => ({ text })) })
  const mark = input => emit('tool.call', { tool: 'mcp__todo-panel__mark_user_tasks', ...input })
  const command = args => emit('command.run', { command: 'todo', args })
  const render = component => emit('ui.render', { component, requestId: 'todo-panel', props: { bodyColumns: 80, hasSurvey: false } })
  const find = (node, key) => node && typeof node === 'object' && (node.props?.key === key ? node : node.children?.map(n => find(n, key)).find(Boolean))
  const press = (tree, key) => { const node = find(tree, key); assert.ok(node, key); return node.props.onPress() }
  return { set, mark, command, render, press, statuses, state: () => state,
    registerAgain: () => {
      const other = [], sink = []
      register((name, filter, fn) => other.push({ name, filter: typeof filter === 'function' ? {} : filter, fn: fn || filter }))
      return { command: args => other.find(h => h.name === 'command.run').fn({ ...$, ui: { ...$.ui, status: text => sink.push(text) } }, { command: 'todo', args }) }
    },
    replace: s => { state = s; version++ },
    gate: () => { const g = { reached: deferred(), release: deferred() }; gate = g; return g },
    retry: fn => { retry = fn },
  }
}
async function main() {
  let checks = 0
  for (const surface of ['AbovePrompt', 'Pane']) {
    for (const replacement of [['X','Y','Z'], ['X'], []]) {
      const r = runtime(); await r.set(); await r.render('AbovePrompt'); await r.command('show'); const old = await r.render(surface)
      if (replacement.length) await r.set(replacement); else { await r.command('clear'); await r.set(['A','B','C']) }
      const before = r.state(); await r.press(old, 't1'); assert.equal(r.state(), before); checks++
    }
    const r = runtime(); await r.set(); await r.render('AbovePrompt'); await r.command('show'); const old = await r.render(surface)
    r.retry(() => r.replace({ ...r.state(), listId: r.state().listId + 1, revision: r.state().revision + 1 }))
    const revision = r.state().revision
    await r.press(old, 't0'); assert.equal(r.state().revision, revision + 1); assert.equal(r.state().list.tasks[0].isDone, false); checks++
    const fresh = await r.render(surface); await r.press(fresh, 't0'); assert.equal(r.state().list.tasks[0].isDone, true)
    await r.press(fresh, 't0'); assert.equal(r.state().list.tasks[0].isDone, false); checks++
    await Promise.all([r.press(fresh, 'done'), r.press(fresh, 'done')]); assert.equal(r.state().list.tasks.filter(t => t.isDone).length, 2); checks++
  }
  for (const change of ['done', 'hide', 'clear', 'pin']) {
    const r = runtime(); await r.set(); const tree = await r.render('AbovePrompt')
    // finishNext updates without a preliminary read; gate its status snapshot.
    const g = r.gate(); const pending = r.press(tree, 'done'); await g.reached.promise
    if (change === 'pin') await r.set(['NEW']); else await r.command(change)
    const latest = r.statuses.at(-1), count = r.statuses.length
    g.release.resolve(); await pending
    assert.equal(r.statuses.at(-1), latest); assert.equal(r.statuses.length, count); checks++
  }
  // Two registrations have independent ordering tokens.
  const a = runtime(), b = a.registerAgain(); await a.set()
  const old = await a.render('AbovePrompt'), g = a.gate(); const pending = a.press(old, 'done'); await g.reached.promise
  await b.command('hide'); g.release.resolve(); await pending
  assert.match(a.statuses.at(-1), /B/); checks++
  // Legacy states normalize missing generation to zero.
  const r = runtime(); await r.set(); r.replace({ ...r.state(), listId: undefined }); await r.render('AbovePrompt'); await r.command('show')
  const tree = await r.render('AbovePrompt'); await r.press(tree, 't0'); assert.equal(r.state().list.tasks[0].isDone, true); checks++
  // GH #13: the clear button carries the generation it was drawn for, so a press after
  // a replacement or re-pin must leave the newer list alone.
  const failures = []
  async function check(name, fn) {
    try {
      await fn()
      checks++
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
    }
  }
  // Pin A, complete it, and keep the clear callback the completed list rendered.
  const completed = async surface => {
    const r = runtime()
    await r.set(['A'])
    await r.command('done')
    return { r, stale: await r.render(surface) }
  }
  for (const surface of ['AbovePrompt', 'Pane']) {
    await check(`${surface}: stale clear keeps a replacement list`, async () => {
      const { r, stale } = await completed(surface)
      await r.set(['B'])
      const before = r.state()
      await r.press(stale, 'clear')
      assert.equal(r.state(), before)
      assert.equal(r.state().list.tasks[0].text, 'B')
      assert.equal(r.state().list.tasks[0].isDone, false)
      assert.equal(r.state().listId, before.listId)
      assert.equal(r.state().revision, before.revision)
    })
    await check(`${surface}: stale clear is rechecked when the atomic update retries`, async () => {
      const { r, stale } = await completed(surface)
      const listId = r.state().listId + 1, revision = r.state().revision + 1
      // Replace A with B between the first computation and its commit.
      r.retry(() => r.replace({
        ...r.state(),
        list: { title: 'replacement', tasks: [{ text: 'B', isDone: false }] },
        listId,
        revision,
      }))
      await r.press(stale, 'clear')
      assert.equal(r.state().listId, listId)
      assert.equal(r.state().revision, revision)
      assert.equal(r.state().list.tasks[0].text, 'B')
      assert.equal(r.state().list.tasks[0].isDone, false)
    })
    await check(`${surface}: stale clear is rejected after clearing and re-pinning`, async () => {
      const { r, stale } = await completed(surface)
      await r.press(stale, 'clear')
      assert.equal(r.state().list, null)
      await r.set(['A'])
      const before = r.state()
      await r.press(stale, 'clear')
      assert.equal(r.state(), before)
      assert.equal(r.state().list.tasks[0].text, 'A')
    })
    await check(`${surface}: stale clear is rejected after an identical re-pin`, async () => {
      const { r, stale } = await completed(surface)
      await r.set(['A'])
      const before = r.state()
      await r.press(stale, 'clear')
      assert.equal(r.state(), before)
      assert.equal(r.state().listId, before.listId)
      assert.equal(r.state().list.tasks[0].text, 'A')
    })
    await check(`${surface}: clear on its own generation still clears`, async () => {
      const { r, stale } = await completed(surface)
      const before = r.state()
      await r.press(stale, 'clear')
      assert.equal(r.state().list, null)
      assert.equal(r.state().listId, before.listId + 1)
      assert.equal(r.state().revision, before.revision + 1)
    })
  }
  // The model tool's clear and /todo clear keep clearing unconditionally.
  await check('model clear ignores a stale listId', async () => {
    const r = runtime()
    await r.set(['A'])
    await r.set(['B'])
    const before = r.state()
    await r.mark({ clear: true, listId: before.listId - 1 })
    assert.equal(r.state().list, null)
    assert.equal(r.state().listId, before.listId + 1)
  })
  await check('/todo clear stays unconditional', async () => {
    const r = runtime()
    await r.set(['A'])
    await r.set(['B'])
    const before = r.state()
    await r.command('clear')
    assert.equal(r.state().list, null)
    assert.equal(r.state().listId, before.listId + 1)
  })
  if (failures.length) throw new Error(`${failures.length} new scenario(s) failed:\n${failures.join('\n')}`)
  console.log(`${checks} UI race regression scenarios passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
