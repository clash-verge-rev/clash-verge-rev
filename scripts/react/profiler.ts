import type { ProfilerOnRenderCallback } from 'react'

export type ProfileRecord = Parameters<ProfilerOnRenderCallback>

const records: ProfileRecord[] = []

export const recordRender: ProfilerOnRenderCallback = (...record) => {
  if (records.length === 1000) records.shift()
  records.push(record)
}

export const profiler = {
  read: () => records.map((record) => [...record]),
  clear: () => {
    records.length = 0
  },
}

Object.assign(window, { __CVR_REACT_PROFILER__: profiler })
