// Global Iterator polyfill for Chromium < 122 & older mobile WebViews
if (typeof (globalThis as any).Iterator === "undefined") {
  (globalThis as any).Iterator = class Iterator {};
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/authContext";
import "./index.css";
import { initPwa } from "./pwa/pwa";

initPwa();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
