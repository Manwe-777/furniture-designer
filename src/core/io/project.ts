import { defaultSettings } from '../defaults'
import type { Design } from '../types'
import { SCHEMA_VERSION } from '../types'

export function serializeDesign(design: Design): string {
  return JSON.stringify(design, null, 2)
}

export class ProjectParseError extends Error {}

/**
 * Parse a saved project, migrating older schema versions forward.
 *
 * Validation is deliberately shallow — enough to reject a file that is not a design
 * at all, and to fill in fields added after the file was written, without rejecting
 * a project because of a field this version does not care about.
 */
export function parseDesign(json: string): Design {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ProjectParseError('That file is not valid JSON')
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectParseError('That file does not contain a design')
  }

  const candidate = raw as Partial<Design>
  if (!Array.isArray(candidate.cabinets) || !Array.isArray(candidate.materials)) {
    throw new ProjectParseError('That file does not look like a furniture design')
  }

  const version = candidate.schemaVersion ?? 0
  if (version > SCHEMA_VERSION) {
    throw new ProjectParseError(
      `This project was saved by a newer version of the app (schema ${version})`,
    )
  }

  return migrate({
    schemaVersion: version,
    name: candidate.name ?? 'Untitled design',
    materials: candidate.materials,
    cabinets: candidate.cabinets,
    worktops: candidate.worktops ?? [],
    settings: { ...defaultSettings(), ...(candidate.settings ?? {}) },
  })
}

function migrate(design: Design): Design {
  // Only one schema version so far; future migrations chain from here.
  return { ...design, schemaVersion: SCHEMA_VERSION }
}
