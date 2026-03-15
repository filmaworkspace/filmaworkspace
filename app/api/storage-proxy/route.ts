// app/api/storage-proxy/route.ts
// Proxy para descargar archivos de Firebase Storage sin restricciones CORS
// El servidor no tiene CORS — descarga el archivo y lo reenvía al cliente

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Validar que la URL sea de Firebase Storage (seguridad)
  if (!url.includes("firebasestorage.googleapis.com") && !url.includes("firebasestorage.app")) {
    return NextResponse.json({ error: "Invalid storage URL" }, { status: 403 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Storage fetch failed: ${response.status}` },
        { status: response.status }
      );
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Storage proxy error:", error);
    return NextResponse.json({ error: "Proxy fetch failed" }, { status: 500 });
  }
}
