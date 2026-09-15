import { describe, expect, it } from 'vitest'
import {
  buildCutOrder,
  cutOrderBlocks,
  cutOrderToCsv,
  cutOrderWarnings,
  BAND_MIN,
  CUT_MIN,
} from './cutOrder'
import { buildXlsx, columnName } from './xlsx'
import { buildBom } from '../bom'
import { buildDesign, materialsById } from '../build/buildDesign'
import { cellWith, newCabinet, newDesign, shelvesContent } from '../defaults'
import type { Cabinet, Design, Material } from '../types'

const bomOf = (d: Design) => buildBom(buildDesign(d).parts, materialsById(d))

const design = (cab: Partial<Cabinet> = {}, extra: Partial<Design> = {}): Design => ({
  ...newDesign(),
  cabinets: [
    newCabinet({
      width: 800, height: 900, depth: 300,
      back: { style: 'none', thickness: 0, rebateDepth: 0 },
      root: cellWith(shelvesContent(2)),
      ...cab,
    }),
  ],
  ...extra,
})

describe('xlsx writer', () => {
  it('names columns the way spreadsheets do', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
    expect(columnName(27)).toBe('AB')
  })

  it('produces a real ZIP container', async () => {
    const blob = buildXlsx([{ name: 'S', rows: [['a', 1]] }])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    // Local file header magic, and the end-of-central-directory record.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const tail = bytes.slice(-22)
    expect([...tail.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06])
    expect(blob.type).toContain('spreadsheetml')
  })

  it('escapes text that would otherwise break the XML', async () => {
    const blob = buildXlsx([{ name: 'S', rows: [['a & b <c> "d"']] }])
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
    expect(text).toContain('a &amp; b &lt;c&gt;')
    expect(text).not.toContain('a & b <c>')
  })
})

describe('cutting order', () => {
  it('has one worksheet per sheet material', async () => {
    const d = design()
    const blob = buildCutOrder(d, bomOf(d))
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
    expect(text).toContain('LISTADO DE CORTE')
    expect(text).toContain('1° med (sentido veta)')
    expect(text).toContain('MDF 18mm')
  })

  it('keeps supplied parts off the cutting tabs', async () => {
    const OAK: Material = {
      id: 'oak', name: 'Roble', thickness: 24, sheet: { length: 2600, width: 1830 },
      pricePerSheet: 0, hasGrain: true, color: '#b07a3c', supplied: true,
    }
    const d = design({ panelMaterials: { top: 'oak' } })
    d.materials = [...d.materials, OAK]
    const blob = buildCutOrder(d, bomOf(d))
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
    // They get their own clearly-labelled tab rather than reaching the saw.
    expect(text).toContain('NO CORTAR')
    expect(text).toContain('PIEZAS PROVISTAS')
  })
})

describe('order checks', () => {
  it('flags compensation, because the shop applies banding to the size you give', () => {
    const d = design({ banding: { enabled: true, thickness: 1, compensate: true } })
    const w = cutOrderWarnings(d, bomOf(d))
    expect(w.some((x) => x.severity === 'error' && /compensation must be off/.test(x.message))).toBe(true)
  })

  it('passes when compensation is off', () => {
    const d = design({ banding: { enabled: true, thickness: 1, compensate: false } })
    expect(cutOrderWarnings(d, bomOf(d)).some((x) => /compensation/.test(x.message))).toBe(false)
  })

  it('flags a piece too small for the machine to cut', () => {
    const d = design({ width: 200, height: 120, depth: 60 })
    const w = cutOrderWarnings(d, bomOf(d))
    expect(w.some((x) => x.severity === 'error' && x.message.includes(String(CUT_MIN)))).toBe(true)
  })

  it('flags a banded piece too narrow to machine-band', () => {
    const d = design({
      depth: 120,
      banding: { enabled: true, thickness: 1, compensate: false },
    })
    const w = cutOrderWarnings(d, bomOf(d))
    expect(w.some((x) => x.message.includes(String(BAND_MIN)))).toBe(true)
  })

  it('notes two banding formats without calling it illegal', () => {
    const d = newDesign()
    d.cabinets = [
      newCabinet({ banding: { enabled: true, thickness: 1, compensate: false } }),
      newCabinet({ banding: { enabled: true, thickness: 2, compensate: false } }),
    ]
    const w = cutOrderWarnings(d, bomOf(d))
    // The shop's limit is per piece, and each piece has one format by construction.
    expect(w.some((x) => /order both/.test(x.message))).toBe(true)
    expect(w.every((x) => x.severity !== 'error' || !/banding format/.test(x.message))).toBe(true)
  })
})

describe('csv mirrors the xlsx', () => {
  it('uses the shop columns, in their order', () => {
    const d = design()
    const csv = cutOrderToCsv(d, bomOf(d))
    const header = csv.split('\n').find((l) => l.startsWith('Cant,'))!
    expect(header).toBe(
      'Cant,1° med (sentido veta),2° med,ESPESOR CANTO,1° MED A,1° MED B,2° MED A,2° MED B,Observaciones',
    )
  })

  it('carries exactly the rows the worksheets carry', () => {
    const d = design()
    const bom = bomOf(d)
    const blocks = cutOrderBlocks(d, bom)
    const csvLines = cutOrderToCsv(d, bom).split('\n')
    const blockLines = blocks.reduce((sum, b) => sum + b.rows.length, 0)
    // Every block row, plus one blank line between blocks.
    expect(csvLines.length).toBe(blockLines + (blocks.length - 1))
  })

  it('puts the grain direction first, as their guide requires', () => {
    // Their sheet: the same rectangle is written 400x680 or 680x400 depending on
    // which way the grain runs, so column 2 is the grain direction, not the longer
    // side. A grained material must therefore never be reoriented.
    const d = design()
    d.materials = d.materials.map((m) =>
      m.id === 'mdf18' ? { ...m, hasGrain: true } : m,
    )
    const bom = bomOf(d)
    const shelf = bom.rows.find((r) => r.label === 'Shelf')!
    const parts = buildDesign(d).parts.filter((p) => p.role === 'shelf')
    expect(shelf.length).toBe(parts[0].length)
    expect(shelf.width).toBe(parts[0].width)
  })

  it('escapes a label containing a comma', () => {
    const d = design({}, { name: 'Mesa, grande' })
    expect(cutOrderToCsv(d, bomOf(d))).toContain('"Mesa, grande"')
  })
})
