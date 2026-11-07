// Small CSV reader: quoted fields, embedded commas and newlines, a leading BOM. Shared by the scoring and village-import scripts.
export function parseCsv(txt: string): string[][] {
  const out: string[][] = []
  let row: string[] = [], c = '', q = false
  const s = txt.replace(/^﻿/, '')
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]
    if (q) {
      if (ch === '"') {
        if (s[k + 1] === '"') { c += '"'; k++ } else q = false
      } else c += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(c); c = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[k + 1] === '\n') k++
      row.push(c); c = ''
      if (row.some((x) => x !== '')) out.push(row)
      row = []
    } else c += ch
  }
  row.push(c)
  if (row.some((x) => x !== '')) out.push(row)
  return out
}
