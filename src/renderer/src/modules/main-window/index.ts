import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { MainWindowErrorBoundary } from './components/MainWindowErrorBoundary';
import '../../styles/main-window.css';

export function mountMainWindow(): void {
  const element = document.getElementById('root');
  if (!element) throw new Error('找不到主視窗掛載位置。');
  const root = createRoot(element);
  root.render(createElement(MainWindowErrorBoundary, null, createElement(App)));
}
