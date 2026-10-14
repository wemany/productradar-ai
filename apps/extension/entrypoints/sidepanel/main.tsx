import '../../src/zod-config';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../src/styles/global.css';
import { App } from '../../src/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
