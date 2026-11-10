export type ButtonVariant = "primary" | "ghost" | "action" | "danger"

/**
 * The four button styles the app actually has.
 *
 * The variant is the CSS class, verbatim — this component exists so a call site
 * says which kind of button it is, not which class it remembered to type.
 * `className` appends the existing modifiers ("wide", "join-link", …) so the
 * rendered markup stays byte-identical to what the stylesheet expects.
 */
export function Button({
  variant,
  className,
  type,
  disabled,
  title,
  ariaLabel,
  onClick,
  children,
}: {
  variant: ButtonVariant
  className?: string
  type?: "button" | "submit"
  disabled?: boolean
  title?: string
  ariaLabel?: string
  onClick?: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      className={className ? `${variant} ${className}` : variant}
      type={type}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
