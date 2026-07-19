"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams() as { id: string };
  const pathname = usePathname();
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
    const clean = `/project/${id}`;
    if (window.location.pathname !== clean) {
      window.history.replaceState(null, "", clean);
    }
  }, [pathname, id]);

  return <>{children}</>;
}
