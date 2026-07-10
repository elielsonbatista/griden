import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

document.documentElement.classList.add("dark");

// Blocks the webview's native context menu (Inspect, Reload, etc.).
// The app's own context menus (Radix) call preventDefault on their trigger and
// open normally; copy/paste still work via keyboard shortcuts.
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <Toaster position="bottom-right" />
  </React.StrictMode>,
);
