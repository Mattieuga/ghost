import { GhostLayout } from "@/components/layout";
import { EditorWindow } from "@/components/editor-window";

function App() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const filePath = params.get("file");

  if (mode === "editor" && filePath) {
    return <EditorWindow filePath={decodeURIComponent(filePath)} />;
  }

  return <GhostLayout />;
}

export default App;
