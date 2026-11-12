import type { Metadata } from "next";
import { Suspense } from "react";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: "Sign in · HashiNet", robots: { index: false } };

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
