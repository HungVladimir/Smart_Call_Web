import fs from 'node:fs'
import path from 'node:path'
import { parse as parseJavaScript } from '@babel/parser'
import { parse as parseVue } from '@vue/compiler-sfc'

/** Kiểm tra đường import và ranh giới tầng; không nạp SDK hoặc chạy ứng dụng. */
const sourceRoot = path.resolve('src')
const files = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(full)
    else if (/\.(js|vue)$/.test(entry.name)) files.push(full)
  }
}
collect(sourceRoot)
const errors = [],
  graph = new Map()
const relative = (file) => path.relative(sourceRoot, file).replaceAll('\\', '/')
const callStateFields = new Set([
  'isRegistered',
  'dialing',
  'activeCall',
  'incomingCall',
  'callNotice',
])
const removedFields = new Set([
  'pinned',
  'readStatus',
  'readers',
  'unread',
  'unreadCount',
  'updatePinnedMessage',
])
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const code = file.endsWith('.vue')
    ? parseVue(source).descriptor.scriptSetup?.content || ''
    : source
  const tree = parseJavaScript(code, { sourceType: 'module' })
  const dependencies = []
  function dependency(value) {
    if (!value.startsWith('.') && !value.startsWith('@/')) return
    const base = value.startsWith('@/')
      ? path.join(sourceRoot, value.slice(2))
      : path.resolve(path.dirname(file), value)
    const target = [base, base + '.js', base + '.vue', path.join(base, 'index.js')].find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    )
    if (!target) {
      errors.push(relative(file) + ': import không tồn tại: ' + value)
      return
    }
    if (!target.startsWith(sourceRoot + path.sep)) {
      errors.push(relative(file) + ': import ra ngoài mã Web')
      return
    }
    const from = relative(file),
      to = relative(target)
    if (from.startsWith('core/') && /^(app|features)\//.test(to))
      errors.push(from + ': core không được import ' + to)
    if (
      /^features\/[^/]+\/(services|domain|state|mappers|composables)\//.test(from) &&
      to.startsWith('app/')
    )
      errors.push(from + ': nghiệp vụ không được import composition root')
    if (/\.(js|vue)$/.test(target)) dependencies.push(target)
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (
      node.type === 'ImportDeclaration' ||
      (node.type === 'ExportNamedDeclaration' && node.source)
    )
      dependency(node.source.value)
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Import' &&
      node.arguments[0]?.type === 'StringLiteral'
    )
      dependency(node.arguments[0].value)
    if (node.type === 'ImportExpression' && node.source.type === 'StringLiteral')
      dependency(node.source.value)
    if (
      ['MemberExpression', 'OptionalMemberExpression'].includes(node.type) &&
      node.object?.name === 'callState' &&
      !node.computed &&
      !callStateFields.has(node.property.name)
    )
      errors.push(relative(file) + ': field callState không tồn tại: ' + node.property.name)
    if (node.type === 'Identifier' && removedFields.has(node.name))
      errors.push(relative(file) + ': còn identifier tính năng đã bỏ: ' + node.name)
    if (
      file.endsWith('.vue') &&
      node.type === 'CallExpression' &&
      ['fetch', 'createSessionFetch'].includes(node.callee.name)
    )
      errors.push(relative(file) + ': Vue component không được gọi HTTP trực tiếp')
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(key)) continue
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(tree)
  graph.set(file, dependencies)
}
const visited = new Set(),
  stack = []
function checkCycles(file) {
  if (stack.includes(file)) {
    errors.push(
      'Import cycle: ' + [...stack.slice(stack.indexOf(file)), file].map(relative).join(' → '),
    )
    return
  }
  if (visited.has(file)) return
  stack.push(file)
  for (const target of graph.get(file) || []) checkCycles(target)
  stack.pop()
  visited.add(file)
}
for (const file of files) checkCycles(file)
for (const directory of ['services', 'views', 'components', 'router'])
  if (fs.existsSync(path.join(sourceRoot, directory)))
    errors.push('Còn thư mục legacy src/' + directory)
if (errors.length) {
  console.error([...new Set(errors)].join('\n'))
  process.exitCode = 1
} else {
  console.log(
    'Đạt: ' +
      files.length +
      ' module Web; không có import thiếu, cycle, HTTP trong component hoặc tính năng pin/read cũ.',
  )
}
