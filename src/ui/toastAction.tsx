// 带单个行动按钮的 toast(S6-5 整笔撤销第二入口)。独立文件:toast.tsx 输出组件
// (ToastHost),react-refresh 规则不许再混非组件导出。
import React from 'react'
import { notifications } from '@mantine/notifications'
import { cn } from '../utils/cn'
import { useToastStore } from './toast'

export function toastAction(message: string, action: { label: string; onClick: () => void }, ttl = 6000): void {
  const id = `toast-action-${Math.random().toString(36).slice(2, 8)}`
  try {
    notifications.show({
      id,
      color: 'gray',
      autoClose: ttl,
      message: React.createElement(
        'span',
        { className: cn('inline-flex items-center gap-3') },
        React.createElement('span', null, message),
        React.createElement(
          'button',
          {
            type: 'button',
            className: cn('border-0 bg-transparent p-0 cursor-pointer text-nomi-accent font-medium hover:underline'),
            onClick: () => {
              notifications.hide(id)
              action.onClick()
            },
          },
          action.label,
        ),
      ),
    })
  } catch {
    useToastStore.getState().push({ message: `${message}(${action.label}请到 AI 面板操作)` })
  }
}
