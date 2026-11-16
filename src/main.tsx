import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AndroidApp from "./AndroidApp";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Sea Siege: #root element was not found");

createRoot(root).render(
  <StrictMode>
    <AndroidApp />
  </StrictMode>,
);
