import { describe, expect, it } from 'vitest'
import { buildCutOrder, cutOrderWarnings, BAND_MIN, CUT_MIN } from './cutOrder'
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

  it('flags more than one banding format', () => {
    const d = newDesign()
    d.cabinets = [
      newCabinet({ banding: { enabled: true, thickness: 1, compensate: false } }),
      newCabinet({ banding: { enabled: true, thickness: 2, compensate: false } }),
    ]
    expect(cutOrderWarnings(d, bomOf(d)).some((x) => /one banding format/.test(x.message))).toBe(true)
  })
})
