"use client";

import { useLayoutEffect } from "react";

/** Arriving here from a signed-in page, the head script has already run: switch to dark now. */
export function AlwaysDark() {
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);
  return null;
}
