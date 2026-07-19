"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useParams, usePathname } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useRealPathname } from "@/contexts/RealPathnameContext";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams() as { id: string };
  const pathname = usePathname();
  const { setRealPathname } = useRealPathname();
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, "projects", id)).then((snap) => {
      if (snap.exists()) setProjectName(snap.data().name ?? null);
    });
  }, [id]);

  useEffect(() => {
    document.title = projectName ? `${projectName} | FW` : "Filma Workspace";
  }, [projectName]);

  useEffect(() => {
    // Commit the real pathname to context BEFORE masking the URL,
    // so the Header re-renders with the correct section already set.
    flushSync(() => setRealPathname(pathname));
    const clean = `/project/${id}`;
    if (window.location.pathname !== clean) {
      window.history.replaceState(null, "", clean);
    }
  }, [pathname, id]);

  return <>{children}</>;
}
