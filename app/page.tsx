import type { Metadata } from "next";
import { MaterialStudio } from "./components/MaterialStudio";

export const metadata: Metadata = {
  title: "Forge Material Studio",
  description: "A local-first procedural PBR material authoring workspace.",
};

export default function Home() {
  return <MaterialStudio />;
}
