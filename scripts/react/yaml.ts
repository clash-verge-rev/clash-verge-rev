import * as yaml from 'fixture-yaml'
export * from 'fixture-yaml'

import { fixture } from './state'

export function dump(value: any, options: any) {
  fixture.serialized.push(structuredClone(value))
  return yaml.dump(value, options)
}
