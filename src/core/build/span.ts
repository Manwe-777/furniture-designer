import { mm } from '../geom'
import type { Size } from '../types'

/**
 * Divide a span between children that are either a fixed size or a weighted share
 * of whatever is left over.
 *
 *     available = span − (childCount − 1) × dividerThickness
 *     flex children share (available − Σ fixed) by weight
 *
 * This is the reason sizes stay correct when you resize a cabinet: "left column
 * exactly 400mm, the rest fills" survives the change without re-entering numbers.
 *
 * Returns sizes that sum exactly to `available` (the last flex child absorbs any
 * rounding dust, so the panels always add up).
 */
export function resolveSizes(
  sizes: Size[],
  span: number,
  dividerThickness: number,
): number[] {
  const n = sizes.length
  if (n === 0) return []

  const available = span - (n - 1) * dividerThickness
  const fixedTotal = sizes.reduce((sum, s) => (s.mode === 'fixed' ? sum + s.mm : sum), 0)
  const flexIndices = sizes.map((s, i) => (s.mode === 'flex' ? i : -1)).filter((i) => i >= 0)
  const weightTotal = flexIndices.reduce((sum, i) => {
    const s = sizes[i]
    return sum + (s.mode === 'flex' ? Math.max(0, s.weight) : 0)
  }, 0)

  const out = sizes.map((s) => (s.mode === 'fixed' ? s.mm : 0))

  if (flexIndices.length > 0) {
    const remainder = available - fixedTotal
    if (weightTotal > 0) {
      for (const i of flexIndices) {
        const s = sizes[i]
        const weight = s.mode === 'flex' ? Math.max(0, s.weight) : 0
        out[i] = (remainder * weight) / weightTotal
      }
    } else {
      // All weights zero: share equally rather than collapsing to nothing.
      for (const i of flexIndices) out[i] = remainder / flexIndices.length
    }

    // Push accumulated rounding into the last flex child so the sum is exact.
    const rounded = out.map(mm)
    const last = flexIndices[flexIndices.length - 1]
    const drift = mm(available) - rounded.reduce((a, b) => a + b, 0)
    rounded[last] = mm(rounded[last] + drift)
    return rounded
  }

  return out.map(mm)
}

/** How much of a span is unaccounted for. Negative means the fixed sizes overflow. */
export function spanSlack(sizes: Size[], span: number, dividerThickness: number): number {
  const n = sizes.length
  const available = span - Math.max(0, n - 1) * dividerThickness
  const fixedTotal = sizes.reduce((sum, s) => (s.mode === 'fixed' ? sum + s.mm : sum), 0)
  return mm(available - fixedTotal)
}
