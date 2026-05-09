import React from "react";
import ReactDOM from "react-dom/client";
import "@shopify/polaris/build/esm/styles.css";
import App from "./App.jsx";
import { createApp } from "@shopify/app-bridge";

const host = new URLSearchParams(window.location.search).get("host");

if (!host) {
    document.body.innerHTML = "Missing host — app not embedded correctly";
    throw new Error("No host param");
}

// ✅ export the app instance
export const app = createApp({
    apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
    host,
    forceRedirect: true,
});

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);