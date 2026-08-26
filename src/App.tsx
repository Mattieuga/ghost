import { lazy, Suspense } from "react";
import { GhostLayout } from "@/components/layout";
import { EditorWindow } from "@/components/editor-window";

const CollaborationSpike = lazy(async () => {
  const module = await import("@/spikes/collaboration/collaboration-spike");
  return { default: module.CollaborationSpike };
});

function App() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const filePath = params.get("file");

  if (mode === "collaboration-spike") {
    return (
      <Suspense fallback={null}>
        <CollaborationSpike />
      </Suspense>
    );
  }

  if (mode === "editor" && filePath) {
    return <EditorWindow filePath={decodeURIComponent(filePath)} />;
  }

  return <GhostLayout />;
}

export default App;
