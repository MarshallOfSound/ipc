import React from 'react';
import { createRoot } from 'react-dom/client';
import { useCounterStore, CounterStoreState } from './ipc/renderer-hooks/e2e.test';

// Expose state for testing
declare global {
  interface Window {
    __STORE_STATE__: CounterStoreState | null;
    __RENDER_COUNT__: number;
    __EVENT_RECEIVED__: string[];
  }
}

window.__STORE_STATE__ = null;
window.__RENDER_COUNT__ = 0;
window.__EVENT_RECEIVED__ = [];

// Set up event listener for OnValueChanged
const testApi = (window as any)['e2e.test']?.['TestAPI'];
if (testApi?.onOnValueChanged) {
  testApi.onOnValueChanged((value: string) => {
    window.__EVENT_RECEIVED__.push(value);
  });
}

function CounterDisplay() {
  const storeState = useCounterStore();

  // Track state for E2E tests
  window.__STORE_STATE__ = storeState;
  window.__RENDER_COUNT__++;

  return (
    <div id="counter-display">
      <div id="state">{storeState.state}</div>
      {storeState.state === 'ready' && <div id="value">{storeState.result}</div>}
      {storeState.state === 'error' && <div id="error">{storeState.error.message}</div>}
      <div id="render-count">{window.__RENDER_COUNT__}</div>
    </div>
  );
}

function App() {
  return (
    <div>
      <h1>React Hook Test</h1>
      <CounterDisplay />
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
