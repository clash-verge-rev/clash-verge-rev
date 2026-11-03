import whyDidYouRender from '@welldone-software/why-did-you-render'
import React from 'react'

whyDidYouRender(React, {
  include: [/^(ProxyItem|ProxyItemMini|ProxyTunCard)$/],
  trackAllPureComponents: false,
  trackHooks: true,
})

await import('../../src/main')
