"use client";

import dynamic from "next/dynamic";

// The kiosk keeps its settings and unsent events on the tablet, so it renders in the browser only.
const Kiosk = dynamic(() => import("./kiosk").then((m) => m.Kiosk), { ssr: false });

export default function KioskPage() {
  return <Kiosk />;
}
