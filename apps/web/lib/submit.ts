"use client";

import { useState } from "react";
import { useToast } from "@/components/hearth/ui";
import { ApiRequestError, messageOf } from "./api";

/**
 * A form's send: busy while it runs, the API's per-field messages kept for the fields, and any
 * other failure as a toast. `run` resolves true when the call went through.
 */
export function useSubmit() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (send: () => Promise<unknown>, done: string | null): Promise<boolean> => {
    setBusy(true);
    setErrors({});
    try {
      await send();
      if (done) toast(done);
      return true;
    } catch (e) {
      if (e instanceof ApiRequestError && e.details) setErrors(e.details);
      else toast(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, setErrors, run };
}
