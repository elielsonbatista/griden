import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

document.documentElement.classList.add("dark");

// Bloqueia o menu de contexto nativo do webview (Inspecionar, Recarregar, etc.).
// Os menus de contexto próprios (Radix) chamam preventDefault no seu trigger e
// abrem normalmente; cópia/colagem seguem via atalhos de teclado.
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <Toaster position="bottom-right" />
  </React.StrictMode>,
);
