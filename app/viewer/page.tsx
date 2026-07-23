import type { Metadata } from "next";
import { MaterialViewerClient } from "../components/MaterialViewerClient";

export const metadata: Metadata = {
  title: "Material Viewer",
  description: "Inspect Forge material packages locally in your browser.",
};

export default function ViewerPage() {
  return <MaterialViewerClient />;
}
