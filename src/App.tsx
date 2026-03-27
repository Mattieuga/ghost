import { ThemeProvider } from "@/components/theme-provider";
import { GhostLayout } from "@/components/layout";

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <GhostLayout />
    </ThemeProvider>
  );
}

export default App;
