import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Console } from "@/components/net/console";
import "@/styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><Console /></StrictMode>);
