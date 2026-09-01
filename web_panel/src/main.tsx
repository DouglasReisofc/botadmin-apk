import { createRoot } from "react-dom/client";
import RouterApp from "./RouterApp";
import "./styles.css";
import "./public-landing.css";

// The dashboard owns long-lived SSE/WebSocket/media effects. Avoiding a
// development-only StrictMode remount keeps those connections single and
// makes the local web build behave like the production Flutter lifecycle.
createRoot(document.getElementById("root")!).render(<RouterApp />);
