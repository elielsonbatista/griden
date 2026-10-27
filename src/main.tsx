import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { Toaster } from "@/components/ui/sonner";
import "@/index.css";

document.documentElement.classList.add("dark");

// Hides the webview's native menu (Inspect, Reload). Radix menus still open
// because they handle the event on their own trigger.
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <Toaster position="bottom-right" />
  </React.StrictMode>,
);
