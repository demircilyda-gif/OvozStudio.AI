import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== 'undefined') {
      window.location.hash = '#studio';
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#F4F1EA] text-[#161511] p-6 font-sans">
          <div className="max-w-md w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-2xl p-8 shadow-sm text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#0E7C86]/10 text-[#0E7C86] flex items-center justify-center mx-auto text-xl font-bold">
              !
            </div>
            <h2 className="text-xl font-bold tracking-tight text-[#161511]">
              OvozStudio yuklanishida xatolik yuz berdi
            </h2>
            <p className="text-sm text-[#5D594E] leading-relaxed">
              Brauzer tarjimoni yoki xotira yuklanishi sababli sahifa yangilanishi talab etiladi.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[#161511] text-[#F4F1EA] text-sm font-semibold hover:bg-black transition-colors cursor-pointer"
              >
                Studiyani qayta yuklash
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/#studio';
                  window.location.reload();
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-full border border-[rgba(22,21,17,0.2)] text-[#161511] text-sm font-medium hover:bg-[#F4F1EA] transition-colors cursor-pointer"
              >
                Bosh sahifa
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
