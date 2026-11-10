/**
 * The app's one form-row pattern: a label whose text sits above its control,
 * both inside the same `<label>` so clicking the text focuses the field.
 */
export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <label>
      {label}
      {children}
    </label>
  )
}
