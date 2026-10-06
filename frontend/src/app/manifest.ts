import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NextGen ERP",
    short_name: "NextGen ERP",
    description: "ERP for Indian manufacturers",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    shortcuts: [{ name: "Shop-floor kiosk", short_name: "Kiosk", url: "/manufacturing/kiosk" }],
  };
}
