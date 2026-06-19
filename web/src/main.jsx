import React from "react";
import ReactDOM from "react-dom/client";
import "@shopify/polaris/build/esm/styles.css";
import App from "./App.jsx";
import "./appBridge.js";

ReactDOM.createRoot(
    document.getElementById("root")
).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);