import { createHmac, timingSafeEqual } from 'node:crypto'

/** Verify Meta's X-Hub-Signature-256 over the RAW request body. Never accept an unsigned webhook. */
export function sigok(raw: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false
  const want = createHmac('sha256', secret).update(raw, 'utf8').digest()
  let got: Buffer
  try {
    got = Buffer.from(header.slice(7), 'hex')
  } catch {
    return false
  }
  return got.length === want.length && timingSafeEqual(got, want)
}

export interface WaMsg {
  id: string
  from: string
  type: 'text' | 'audio' | 'location' | 'other'
  text?: string
  media?: string
  mime?: string
  lat?: number
  lon?: number
}

/** Flatten Meta's nested webhook payload into plain messages. Unknown shapes yield nothing. */
export function parseWa(js: unknown): WaMsg[] {
  const out: WaMsg[] = []
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
  for (const en of arr((js as { entry?: unknown })?.entry))
    for (const ch of arr(en?.changes))
      for (const m of arr(ch?.value?.messages)) {
        if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue
        if (m.type === 'text' && typeof m.text?.body === 'string') out.push({ id: m.id, from: m.from, type: 'text', text: m.text.body })
        else if (m.type === 'audio' && typeof m.audio?.id === 'string') out.push({ id: m.id, from: m.from, type: 'audio', media: m.audio.id, mime: String(m.audio.mime_type ?? '') })
        else if (m.type === 'location' && Number.isFinite(m.location?.latitude) && Number.isFinite(m.location?.longitude))
          out.push({ id: m.id, from: m.from, type: 'location', lat: Number(m.location.latitude), lon: Number(m.location.longitude) })
        else out.push({ id: m.id, from: m.from, type: 'other' })
      }
  return out
}

/** File extension Transcribe accepts, from a WhatsApp mime type (voice notes are usually ogg/opus). */
export function extOf(mime: string): string | null {
  const m = mime.toLowerCase()
  if (m.includes('ogg') || m.includes('opus')) return 'ogg'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('amr')) return 'amr'
  if (m.includes('wav')) return 'wav'
  return null
}
