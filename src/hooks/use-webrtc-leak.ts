import { useQuery } from '@/services/query-client'

const STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
]
const GATHER_TIMEOUT_MS = 4_000

// Public addresses that STUN servers see for this WebView; null when WebRTC is unavailable.
async function probeWebrtcAddresses(): Promise<string[] | null> {
  if (typeof RTCPeerConnection === 'undefined') return null
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] })
  const addresses = new Set<string>()
  try {
    pc.onicecandidate = (event) => {
      const parts = event.candidate?.candidate.split(' ') ?? []
      // candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type>
      if (parts[7] === 'srflx' && parts[4]) addresses.add(parts[4])
    }
    pc.createDataChannel('probe')
    await pc.setLocalDescription(await pc.createOffer())
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, GATHER_TIMEOUT_MS)
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState !== 'complete') return
        clearTimeout(timer)
        resolve()
      }
    })
    return [...addresses]
  } finally {
    pc.close()
  }
}

export const useWebrtcLeak = () =>
  useQuery({
    queryKey: ['webrtcLeak'],
    queryFn: probeWebrtcAddresses,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
