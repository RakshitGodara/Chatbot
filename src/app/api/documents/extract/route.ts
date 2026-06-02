import { NextResponse } from "next/server";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { supabase } from "@/lib/supabase";

const execFilePromise = promisify(execFile);
const PARSER_SCRIPT = path.join(
  process.cwd(),
  "src",
  "app",
  "api",
  "documents",
  "parse-pdf.js"
);
const TMP_DIR = path.join(process.cwd(), "storage", "tmp");

export async function GET(req: Request) {
  let tmpFilePath: string | null = null;

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

    // Write to temp file for parsing
    await fs.mkdir(TMP_DIR, { recursive: true });
    tmpFilePath = path.join(TMP_DIR, safeFilename);
    const arrayBuf = await fileData.arrayBuffer();
    await fs.writeFile(tmpFilePath, Buffer.from(arrayBuf));

    // Parse PDF using the standalone parser script
    const { stdout } = await execFilePromise("node", [PARSER_SCRIPT, tmpFilePath]);
    const data = JSON.parse(stdout);

    return NextResponse.json({
      text: data.text || "",
      numPages: data.total || 1,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to extract PDF text: ${errorMessage}` },
      { status: 500 }
    );
  } finally {
    if (tmpFilePath) {
      await fs.unlink(tmpFilePath).catch(() => {});
    }
  }
}
