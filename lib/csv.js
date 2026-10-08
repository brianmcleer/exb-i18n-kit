'use strict'
/** Minimal RFC 4180 CSV. Written as UTF-8 with BOM and CRLF so Excel opens accents correctly. */

function cell (v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function toCsv (headers, rows) {
  const lines = [headers.map(cell).join(',')]
  for (const r of rows) lines.push(headers.map(h => cell(r[h])).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

function parseCsv (text) {
  text = String(text).replace(/^﻿/, '')
  // Excel in some regions saves with ";" separators; detect from the header line.
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  const nonEmpty = rows.filter(r => r.some(c => c !== ''))
  if (!nonEmpty.length) return []
  const headers = nonEmpty[0].map(h => h.trim())
  return nonEmpty.slice(1).map(r => {
    const o = {}
    headers.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i] })
    return o
  })
}

module.exports = { toCsv, parseCsv }
