"use client";

import { useEffect } from "react";
import { useParams, usePathname } from "next/navigation";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams() as { id: string };
  const pathname = usePathname();

  useEffect(() => {
    const clean = `/project/${id}`;
    if (window.location.pathname !== clean) {
      window.history.replaceState(null, "", clean);
    }
  }, [pathname, id]);

  return <>{children}</>;
}
