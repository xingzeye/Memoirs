import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readInitialData } from "./lib/api";
import "./styles/app.css";

const root = document.getElementById("memoirs-root");

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App initialData={readInitialData()} />
    </React.StrictMode>,
  );
}
