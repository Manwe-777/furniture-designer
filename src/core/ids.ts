let counter = 0

/** Short unique id for design nodes. Not cryptographic — just needs to be unique. */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Test helper: make ids reproducible. */
export function resetIds(): void {
  counter = 0
}
