/** Why a privileged service is needed. */
export type ServiceRequestReason =
  | 'sysproxyRefused'
  | 'sysproxySidecarReady'
  | 'tunNeedsService'

export interface ServiceRequest {
  readonly reason: ServiceRequestReason
  /** Settings to apply after the core enters service mode. */
  readonly restore?: Partial<IVergeConfig>
}

type Subscriber = () => void

let request: ServiceRequest | null = null
const subscribers = new Set<Subscriber>()

const notify = () => {
  subscribers.forEach((subscriber) => subscriber())
}

export const requestService = (next: ServiceRequest) => {
  request = next
  notify()
}

export const clearServiceRequest = () => {
  if (request === null) return
  request = null
  notify()
}

export const subscribeServiceRequest = (subscriber: Subscriber) => {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

export const getServiceRequest = () => request
