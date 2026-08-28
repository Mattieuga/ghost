import React from "react";
import ReactDOM from "react-dom/client";
import { cloudWebEntryUrl } from "@/cloud/cloud-entry-url";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./styles/fonts.css";
import "./styles/globals.css";

if (!("__TAURI_INTERNALS__" in window)) {
  window.location.replace(cloudWebEntryUrl(window.location.href));
} else {
  void import("./App").then(({ default: App }) => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
