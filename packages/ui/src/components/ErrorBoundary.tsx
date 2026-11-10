import { Component, type ReactNode } from "react"
import { TextoDeErro } from "./TextoDeErro.js"
import { strings, traduzirErro } from "../strings.js"
import { Button } from "./Button.js"

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * The last line: a render crash anywhere in the ready tree lands here instead
 * of a blank page. Reloading is the honest recovery — the vault and session
 * re-open from scratch, which is exactly what a wedged tree needs.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="gate">
          <div className="gate-card">
            <h1>{strings.errors.crashTitle}</h1>
            <p className="error">
              <TextoDeErro texto={traduzirErro(this.state.error)} />
            </p>
            <Button variant="primary" onClick={() => location.reload()}>
              {strings.errors.reload}
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
