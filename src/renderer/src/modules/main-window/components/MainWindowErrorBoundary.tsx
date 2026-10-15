import { Component, type ErrorInfo, type ReactNode } from 'react';

export class MainWindowErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[MainWindow] UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <div className="ui-error" role="alert"><h1>介面暫時無法顯示</h1><p>請重新開啟主視窗。錄音功能仍可獨立運作。</p></div>;
    }
    return this.props.children;
  }
}
