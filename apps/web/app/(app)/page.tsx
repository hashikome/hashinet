"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { homeOf } from "@/lib/nav";
import { useSession } from "@/lib/session";

/** The address alone opens the workspace's home. */
export default function Home() {
  const { me } = useSession();
  const router = useRouter();
  useEffect(() => router.replace(homeOf(me)), [me, router]);
  return null;
}
