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
// Temp dir for downloaded PDFs before parsing
const TMP_DIR = path.join(process.cwd(), "storage", "tmp");

// Helper function to chunk text
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  if (!text) return chunks;

  let i = 0;
  while (i < text.length) {
    const chunk = text.slice(i, i + chunkSize);
    chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

export async function POST(req: Request) {
  let tmpFilePath: string | null = null;

  try {
    const { name } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "Missing document name parameter." },
        { status: 400 }
      );
    }

    const safeFilename = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API Key is not configured.", code: "MISSING_API_KEY" },
        { status: 500 }
      );
    }

    // 1. Download PDF from Supabase Storage to a temp file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(safeFilename);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: "Document not found in storage." },
        { status: 404 }
      );
    }

    await fs.mkdir(TMP_DIR, { recursive: true });
    tmpFilePath = path.join(TMP_DIR, safeFilename);
    const arrayBuf = await fileData.arrayBuffer();
    await fs.writeFile(tmpFilePath, Buffer.from(arrayBuf));

    // 2. Extract text using the parser script
    const { stdout } = await execFilePromise("node", [PARSER_SCRIPT, tmpFilePath]);
    const parsedData = JSON.parse(stdout);
    const fullText = parsedData.text || "";

    if (!fullText.trim()) {
      return NextResponse.json(
        { error: "Document contains no readable text content to index." },
        { status: 400 }
      );
    }

    // 3. Chunk text page-by-page
    interface PageData {
      text: string;
      num: number;
    }

    const chunksWithPage: { text: string; pageNum: number }[] = [];

    if (
      parsedData.pages &&
      Array.isArray(parsedData.pages) &&
      parsedData.pages.length > 0
    ) {
      for (const page of parsedData.pages as PageData[]) {
        const pageChunks = chunkText(page.text || "");
        for (const chunkTextContent of pageChunks) {
          if (chunkTextContent.trim()) {
            chunksWithPage.push({ text: chunkTextContent, pageNum: page.num || 1 });
          }
        }
      }
    } else {
      for (const chunkTextContent of chunkText(fullText)) {
        if (chunkTextContent.trim()) {
          chunksWithPage.push({ text: chunkTextContent, pageNum: 1 });
        }
      }
    }

    if (chunksWithPage.length === 0) {
      return NextResponse.json(
        { error: "Failed to segment document into valid text chunks." },
        { status: 500 }
      );
    }

    // 4. Request embeddings from OpenAI
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: chunksWithPage.map((c) => c.text),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errMsg =
        errorData.error?.message || `HTTP error! status: ${response.status}`;
      return NextResponse.json(
        { error: `OpenAI Embeddings API error: ${errMsg}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const embeddingsList = data.data || [];

    if (embeddingsList.length !== chunksWithPage.length) {
      return NextResponse.json(
        { error: "Received mismatching vectors list from OpenAI embeddings." },
        { status: 500 }
      );
    }

    // 5. Map chunks with embeddings
    const persistedChunks = chunksWithPage.map((chunkInfo, idx) => ({
      index: idx,
      text: chunkInfo.text,
      pageNum: chunkInfo.pageNum,
      embedding: embeddingsList[idx].embedding as number[],
    }));

    // 6. Upsert embeddings into Supabase
    const { error: upsertError } = await supabase
      .from("embeddings")
      .upsert(
        {
          document_name: safeFilename,
          filename: safeFilename,
          chunks: persistedChunks,
        },
        { onConflict: "document_name" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to save embeddings: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      chunksCount: persistedChunks.length,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to index document: ${errorMessage}` },
      { status: 500 }
    );
  } finally {
    // Clean up temp file
    if (tmpFilePath) {
      await fs.unlink(tmpFilePath).catch(() => {});
    }
  }
}
