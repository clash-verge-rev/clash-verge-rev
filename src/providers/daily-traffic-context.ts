import { createContext, use } from 'react'

export interface DailyHostRecord {
  download: number
  upload: number
  lastActive: number
  connectionCount: number
}

export interface DailyHostDisplay extends DailyHostRecord {
  host: string
}

export interface DailyTrafficContextType {
  records: DailyHostDisplay[]
  totalDownload: number
  totalUpload: number
  isLoading: boolean
  refresh: () => Promise<void>
  clear: () => void
}

export const DailyTrafficContext = createContext<DailyTrafficContextType | null>(null)

export const useDailyTrafficContext = () => {
  const context = use(DailyTrafficContext)
  if (!context) {
    throw new Error('useDailyTrafficContext must be used within DailyTrafficProvider')
  }
  return context
}
