import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#1e0720] flex items-center justify-center p-6 font-sans text-white">
          <div className="max-w-md w-full bg-[#242424] border border-white/10 rounded-2xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-red-600/20 flex items-center justify-center text-red-500">
                <AlertCircle size={32} />
              </div>
              <div>
                <h1 className="text-xl font-bold">Kernel Panic</h1>
                <p className="text-xs text-white/50">An unexpected system failure occurred.</p>
              </div>
            </div>

            <div className="bg-black/30 rounded-lg p-4 mb-8 font-mono text-[11px] text-red-400/90 overflow-auto max-h-32 border border-white/5">
              {this.state.error?.message || 'Unknown system error'}
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={this.handleReset}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#E95420] hover:bg-[#c7461a] font-bold transition-all shadow-lg text-sm"
              >
                <RefreshCw size={16} />
                Restart AETHER OS
              </button>
              <button
                onClick={this.handleGoHome}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 hover:bg-white/10 font-bold transition-all text-sm"
              >
                <Home size={16} />
                Return to Login
              </button>
            </div>

            <p className="mt-8 text-center text-[10px] text-white/30">
              Session logs have been preserved for recovery analysis.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
