import { useEffect, useId, useState } from 'react'

interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  hint?: string
  disabled?: boolean
}

/**
 * A numeric input that keeps its own text while you type.
 *
 * Committing on every keystroke makes "800" impossible to reach from "80" without
 * the design rebuilding at "8", "80", "800" — and an intermediate "" or "8" can be
 * an invalid cabinet. So the text is local and only valid numbers are committed.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = 'mm',
  hint,
  disabled,
}: NumberFieldProps) {
  const id = useId()
  const [text, setText] = useState(String(value))

  // Follow the model when it changes elsewhere (undo, a different selection).
  useEffect(() => setText(String(value)), [value])

  const commit = (raw: string) => {
    const parsed = Number(raw)
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      setText(String(value))
      return
    }
    let next = parsed
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    setText(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {label}
        {hint && <em title={hint}>?</em>}
      </span>
      <span className="field-input">
        <input
          id={id}
          type="number"
          value={text}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
    </label>
  )
}

interface SelectFieldProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  hint?: string
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: SelectFieldProps<T>) {
  const id = useId()
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {label}
        {hint && <em title={hint}>?</em>}
      </span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  const id = useId()
  return (
    <label className="field check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="field-label">
        {label}
        {hint && <em title={hint}>?</em>}
      </span>
    </label>
  )
}
