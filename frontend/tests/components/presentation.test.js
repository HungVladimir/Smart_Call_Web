import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import DialerPanel from '../../src/components/call/DialerPanel.vue'
import MessageComposer from '../../src/components/messages/MessageComposer.vue'
import MessageList from '../../src/components/messages/MessageList.vue'
import { mountComponent } from '../helpers/mountComponent.js'

let wrapper
afterEach(() => {
  wrapper?.unmount()
})

it('bàn phím phát đúng digit và không giữ state cuộc gọi', () => {
  const digit = vi.fn(),
    dial = vi.fn()
  wrapper = mountComponent(DialerPanel, {
    props: { modelValue: '4321', onDigit: digit, onDial: dial },
  })
  const keys = wrapper.element.querySelectorAll('.key-btn')
  expect(keys).toHaveLength(12)
  keys[0].click()
  wrapper.element.querySelector('.btn-dial').click()
  expect(digit).toHaveBeenCalledWith('1')
  expect(dial).toHaveBeenCalledTimes(1)
})

it('bàn phím khóa lệnh gọi khi đã có cuộc gọi', () => {
  wrapper = mountComponent(DialerPanel, { props: { isCalling: true } })
  expect(wrapper.element.querySelector('.btn-dial').disabled).toBe(true)
})

it('ô soạn không gửi Enter khi đang composition và phát send khi nhập xong', async () => {
  const send = vi.fn(),
    update = vi.fn()
  wrapper = mountComponent(MessageComposer, {
    props: { modelValue: 'Xin chào', onSend: send, 'onUpdate:modelValue': update },
  })
  const input = wrapper.element.querySelector('textarea')
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
  )
  expect(send).not.toHaveBeenCalled()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(send).toHaveBeenCalledTimes(1)
  input.value = 'Nội dung mới'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(update).toHaveBeenCalledWith('Nội dung mới')
})

it('danh sách tin hiển thị nội dung/thời gian và lỗi gửi', () => {
  wrapper = mountComponent(MessageList, {
    props: {
      messages: [{ id: 'm', sender: 'mine', text: 'Nội dung', time: '10:00', sendFailed: true }],
    },
  })
  expect(wrapper.element.textContent).toContain('Nội dung')
  expect(wrapper.element.textContent).toContain('10:00')
  expect(wrapper.element.textContent).toContain('Gửi thất bại')
  expect(wrapper.element.querySelectorAll('button')).toHaveLength(0)
})
