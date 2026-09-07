import getSystem from './get-system'

const OS = getSystem()

const MONACO_FONT_FAMILY_BASE = [
  'Fira Code',
  'JetBrains Mono',
  'Roboto Mono',
  '"Source Code Pro"',
  'Consolas',
  'Menlo',
  'Monaco',
  'monospace',
  '"Courier New"',
  '"Apple Color Emoji"',
]

if (OS === 'windows') {
  MONACO_FONT_FAMILY_BASE.push('twemoji mozilla')
}

export const MONACO_FONT_FAMILY = MONACO_FONT_FAMILY_BASE.join(', ')
