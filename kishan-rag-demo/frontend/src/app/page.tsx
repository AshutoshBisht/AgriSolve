"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    router.push("/new-ui");
  }, [router]);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#f6f8f6] via-white to-[#f0f7f0] dark:from-[#0a120b] dark:via-[#0f1710] dark:to-[#0a120b]">
        <div className="text-center">
          <div className="inline-block">
            <div className="w-12 h-12 border-4 border-[#2bee3b] border-t-transparent rounded-full animate-spin mb-4"></div>
          </div>
          <p className="text-gray-600 dark:text-gray-400 font-medium">
            Loading AgriSolve...
          </p>
        </div>
      </div>
    );
  }

  return null;
}


