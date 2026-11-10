import { Button } from "../../components/Button.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings } from "../../strings.js"

/**
 * The boot check failed — usually IndexedDB refusing to open. The one thing
 * worse than this screen is the infinite splash it replaces: here the person is
 * told what failed and can try again without hunting for the reload shortcut.
 */
export function GateError({ detail, onRetry }: { detail: string | null; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>{strings.gate.splashTitle}</h1>
        <p className="gate-lead">{strings.errors.boot}</p>
        {detail && (
          <p className="error">
            <TextoDeErro texto={detail} />
          </p>
        )}
        <Button variant="primary" onClick={onRetry}>
          {strings.common.retry}
        </Button>
      </div>
    </div>
  )
}
