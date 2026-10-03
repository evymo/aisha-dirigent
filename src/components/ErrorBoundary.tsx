import { Component, type ErrorInfo, type ReactNode } from "react";
import { safeError } from "@/lib/security/safeLogger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    safeError("ErrorBoundary.caught", { error, componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-navy">
          <div className="text-center max-w-md mx-auto px-6">
            <h1 className="font-serif text-4xl font-bold text-white mb-4">
              Ups!
            </h1>
            <p className="font-sans text-white/60 mb-6">
              Nastala neocekavana chyba. Zkuste obnovit stranku.
            </p>
            <button
              onClick={() => { window.location.href = "/"; }}
              className="bg-gold hover:bg-gold-dark text-navy px-6 py-3 rounded-full font-sans font-semibold text-sm transition-colors"
            >
              Zpet na hlavni stranku
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
