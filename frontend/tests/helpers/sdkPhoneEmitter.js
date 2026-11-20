import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

/** Tái sử dụng chính Emitter/_transferEvents của SDK đã cài; chỉ cô lập client mạng và inner phone. */
export function sdkPhoneEmitter(boundary) {
  const require = createRequire(import.meta.url)
  const source = fs.readFileSync(
    path.join(path.dirname(require.resolve('@wazo/sdk')), 'index.mjs'),
    'utf8',
  )
  const emitterStart = source.indexOf('class Emitter {')
  const emitterEnd = source.indexOf('__webpack_require__.g.wazoClients', emitterStart)
  const start = source.indexOf(
    '    _transferEvents() {',
    source.indexOf('class Phone_Phone extends Emitter'),
  )
  const end = source.indexOf('    _logConnector(', start)
  if (emitterStart < 0 || emitterEnd < 0 || start < 0 || end < 0)
    throw new Error('SDK đổi hợp đồng listener: cập nhật kiểm thử tích hợp')
  const Emitter = vm.runInNewContext(
    source
      .slice(emitterStart, emitterEnd)
      .replace('__WEBPACK_EXTERNAL_MODULE_events__["default"]', 'EventEmitter') + '\nEmitter',
    { EventEmitter },
  )
  const phone = new Emitter()
  Object.assign(phone, boundary)
  delete phone.on
  delete phone.off
  phone.eventEmitter = new EventEmitter()
  phone.client = new Emitter()
  phone.phone = new Emitter()
  phone.phone.isRegistered = () => phone.registered === true
  const constants = Object.fromEntries(
    Object.entries(boundary).filter(([key]) => key.startsWith('ON_')),
  )
  phone._transferEvents = vm.runInNewContext('({' + source.slice(start, end) + '})', {
    web_rtc_client_events: [],
    transportEvents: [],
    WebRTCPhone_namespaceObject: constants,
  })._transferEvents
  return phone
}
