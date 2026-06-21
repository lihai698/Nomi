import React from 'react'
import { createRoot } from 'react-dom/client'
import NomiRouterApp from './NomiRouterApp'
import { RootErrorBoundary } from './ui/ErrorBoundary'
import { MantineProvider, MantineThemeProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
// 自托管品牌字体（本地优先：不依赖系统是否装 Inter/Fraunces，保证任意机器一致）。
// 变量字体族名为 'Inter Variable' / 'Fraunces Variable'，已在 nomi-tokens.css 字栈置首。
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import './styles/index.css'
import { buildNomiTheme } from './theme/nomiTheme'

const DEFAULT_COLOR_SCHEME = 'light'

function primeColorSchemeAttribute() {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-mantine-color-scheme', DEFAULT_COLOR_SCHEME)
}

primeColorSchemeAttribute()

function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useMemo(() => buildNomiTheme(), [])

  return <MantineThemeProvider theme={theme}>{children}</MantineThemeProvider>
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = container ? createRoot(container) : null

root?.render(
  <React.StrictMode>
    <MantineProvider forceColorScheme={DEFAULT_COLOR_SCHEME} defaultColorScheme={DEFAULT_COLOR_SCHEME}>
      <DynamicThemeProvider>
        <ModalsProvider>
          <Notifications position="top-right" zIndex={2000} />
          <RootErrorBoundary>
            <NomiRouterApp />
          </RootErrorBoundary>
        </ModalsProvider>
      </DynamicThemeProvider>
    </MantineProvider>
  </React.StrictMode>
)
