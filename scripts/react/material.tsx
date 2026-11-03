import { Paper as MuiPaper } from 'fixture-material'
export * from 'fixture-material'

import { fixture } from './state'

export function Paper(props: any) {
  const { onClick, elevation, children, sx } = props
  if (onClick && sx?.maxWidth === 160) {
    fixture.tabRenders.push({
      active: elevation === 2,
      indicator: Boolean(children[2]),
      label: children[1].props.children,
    })
  }
  return <MuiPaper {...props} />
}
