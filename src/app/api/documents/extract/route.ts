import { NextResponse } from "next/server";
import path from "path";
import pdfParse from "pdf-parse";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { error: "Missing document name parameter." },
        { status: 400 }
      );
    }

    const safeFilename = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");

    // Download PDF from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(safeFilename);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: "Document not found inside storage." },
        { status: 404 }
      );
    }

    // Parse PDF directly from memory buffer
    const arrayBuf = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const parsedData = await pdfParse(buffer);

    return NextResponse.json({
      text: parsedData.text || "",
      numPages: parsedData.numpages || 1,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to extract PDF text: ${errorMessage}` },
      { status: 500 }
    );
  }
}
