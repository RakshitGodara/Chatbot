import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: cosine similarity for normalized embeddings
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let score = 0;
  for (let i = 0; i < a.length; i++) {
    score += a[i] * b[i];
  }
  return score;
}

function stripConversationPrefix(filename: string): string {
  const index = filename.indexOf("_");
  if (index !== -1) {
    const prefix = filename.substring(0, index);
    if (prefix === "default" || /^\d+$/.test(prefix)) {
      return filename.substring(index + 1);
    }
  }
  return filename;
}

interface ChunkData {
  index: number;
  text: string;
  embedding: number[];
  pageNum?: number;
  filename?: string;
}

export async function POST(req: Request) {
  try {
    const { query, filename, topK = 3 } = await req.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid search query parameter." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API Key is not configured.", code: "MISSING_API_KEY" },
        { status: 500 }
      );
    }

    // 1. Generate embedding for query
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query.trim(),
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
    const queryEmbedding = data.data?.[0]?.embedding as number[];

    if (!queryEmbedding) {
      return NextResponse.json(
        { error: "Failed to generate a valid embedding vector for search query." },
        { status: 500 }
      );
    }

    // 2. Load chunks from Supabase embeddings table
    let allChunks: ChunkData[] = [];

    if (filename) {
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const { data: embRow, error } = await supabase
        .from("embeddings")
        .select("chunks, filename")
        .eq("document_name", safeFilename)
        .maybeSingle();

      if (error || !embRow) {
        return NextResponse.json(
          { error: `The selected document "${filename}" has not been indexed yet.` },
          { status: 400 }
        );
      }

      allChunks = (embRow.chunks as ChunkData[]).map((c) => ({
        ...c,
        filename: embRow.filename,
      }));
    } else {
      // Global search across all embeddings rows
      const { data: rows, error } = await supabase
        .from("embeddings")
        .select("chunks, filename");

      if (error) {
        return NextResponse.json(
          { error: `Failed to load embeddings: ${error.message}` },
          { status: 500 }
        );
      }

      for (const row of rows ?? []) {
        const chunks = (row.chunks as ChunkData[]).map((c) => ({
          ...c,
          filename: row.filename,
        }));
        allChunks.push(...chunks);
      }
    }

    if (allChunks.length === 0) {
      return NextResponse.json(
        { error: "No indexed documents or text chunks were found." },
        { status: 400 }
      );
    }

    // 3. Compute similarity scores and return top-K
    const scoredChunks = allChunks.map((chunk) => ({
      index: chunk.index,
      text: chunk.text,
      pageNum: chunk.pageNum || 1,
      score: parseFloat(cosineSimilarity(queryEmbedding, chunk.embedding).toFixed(4)),
      filename: stripConversationPrefix(chunk.filename || "unknown"),
    }));

    scoredChunks.sort((a, b) => b.score - a.score);

    return NextResponse.json({
      success: true,
      query,
      chunks: scoredChunks.slice(0, topK),
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to retrieve document matches: ${errorMessage}` },
      { status: 500 }
    );
  }
}
