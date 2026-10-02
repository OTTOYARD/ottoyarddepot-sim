import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./pwa/registerServiceWorker";

// The live depot on its own lives at /view.html (its own entry, src/viewer). /view is the short form: hosting serves
// index.html for any unknown path, so send it on, keeping its query.
if (window.location.pathname.replace(/\/+$/, "") === "/view") {
  window.location.replace(`/view.html${window.location.search}`);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
  registerServiceWorker();
}
