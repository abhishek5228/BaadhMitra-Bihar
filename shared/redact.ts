import { ascii } from './gazetteer'

/**
 * Strip personal identifiers BEFORE text is stored or sent to an LLM.
 * Phone numbers, Aadhaar-style 12 digit numbers, UPI ids and emails are replaced
 * with placeholders. The rescue team still has the sender's channel id, so
 * nothing needed for dispatch is lost.
 */
export function redact(raw: string): string {
  let t = ascii(raw)
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]') // emails first (UPI regex is looser)
  t = t.replace(/\b[\w.-]{2,}@[a-z]{2,}\b/gi, '[upi]')
  t = t.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[id]')
  t = t.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]')
  return t.replace(/\s+/g, ' ').trim()
}
