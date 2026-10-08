"use client";

import { useState } from "react";
import { ItemEditor } from "../item-editor";

export default function NewItemPage() {
  const [n, setN] = useState(0);
  return <ItemEditor key={n} onCreateAnother={() => setN((x) => x + 1)} />;
}
