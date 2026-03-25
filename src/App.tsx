import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GhostLayout } from "@/components/layout";

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <TooltipProvider>
        <GhostLayout />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
