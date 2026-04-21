import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

export function useCompactMode(breakpoint = 560): boolean {
  return useSyncExternalStore(subscribe, () => window.innerWidth < breakpoint);
}
