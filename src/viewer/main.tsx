// The live view's own entry (view.html): the depot scene and its feed, without the cockpit around it.
import { createRoot } from "react-dom/client";
import DepotViewer from "./DepotViewer";
import "../index.css";

createRoot(document.getElementById("root")!).render(<DepotViewer />);
