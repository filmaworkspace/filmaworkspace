import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";

// Vercel cron hits this every 15 minutes.
// It checks which projects have sendTime within the current 15-min window
// and triggers send-day for each.

export async function GET(req: NextRequest) {
  // Protect with Vercel cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const currentHour   = now.getHours();
  const currentMinute = now.getMinutes();

  // Build all HH:MM strings within current 15-min window
  const windowTimes: string[] = [];
  const baseMinutes = Math.floor(currentMinute / 15) * 15;
  for (let m = baseMinutes; m < baseMinutes + 15; m++) {
    const hh = String(currentHour).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    windowTimes.push(`${hh}:${mm}`);
  }

  // Query all project horario configs — we need to iterate since Firestore
  // doesn't have a cross-collection query for subcollections without collectionGroup
  // Using collectionGroup "horario" is not possible with doc-level config,
  // so we fetch all projects and check their config.
  // For performance, we only fetch projects that are not in "Finalizado" phase.
  const projectsSnap = await db.collection("projects").where("phase", "!=", "Finalizado").get();

  const triggered: string[] = [];
  const errors: string[] = [];

  for (const projectDoc of projectsSnap.docs) {
    try {
      const configSnap = await db
        .collection("projects").doc(projectDoc.id)
        .collection("horario").doc("config")
        .get();

      if (!configSnap.exists) continue;
      const config = configSnap.data()!;
      if (!config.enabled) continue;

      const sendTime: string = config.sendTime ?? "19:00";
      if (!windowTimes.includes(sendTime)) continue;

      // Check if today's day doc exists and is not yet sent — docId = date
      const daySnap = await db
        .collection("projects").doc(projectDoc.id)
        .collection("horario").doc(todayStr)
        .get();

      if (!daySnap.exists) continue;
      if (daySnap.data()?.status === "sent") continue;

      // Trigger send
      const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";
      const res = await fetch(`${base}/api/horario/send-day`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectDoc.id, date: todayStr }),
      });

      if (res.ok) {
        triggered.push(projectDoc.id);
      } else {
        const body = await res.json().catch(() => ({}));
        errors.push(`${projectDoc.id}: ${body.error}`);
      }
    } catch (err: any) {
      errors.push(`${projectDoc.id}: ${err.message}`);
    }
  }

  return NextResponse.json({ triggered, errors, window: windowTimes, date: todayStr });
}
