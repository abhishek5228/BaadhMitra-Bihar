// Writes docs/cwc-bihar-stations.json: the official CWC marks as a ready `stations` table for a feed map.
//   npx tsx scripts/cwc-table.ts
import { writeFileSync } from 'node:fs'
import { stationTable } from '../shared/cwc'

const doc = {
  _note: 'Warning/danger marks read from CWC flood bulletins (see shared/cwc.ts for the bulletin of each). Positions are the nearest town, not the gauge. Rename the keys to the station codes your feed uses.',
  stations: stationTable(),
}
writeFileSync('docs/cwc-bihar-stations.json', JSON.stringify(doc, null, 2) + '\n')
console.log('wrote', Object.keys(doc.stations).length, 'stations')
