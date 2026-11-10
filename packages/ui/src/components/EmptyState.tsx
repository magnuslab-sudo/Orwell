import { Button } from "./Button.js"

/** The one empty-screen shape: a title, an honest sentence, maybe a way out. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void } | undefined
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
