import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const BUCKET = "documents";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");

    let query = supabase
      .from("documents")
      .select("*")
      .order("uploaded_at", { ascending: true });

    if (conversationId) {
      query = query.eq("conversation_id", conversationId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `Failed to list documents: ${error.message}` },
        { status: 500 }
      );
    }

    // Check which documents have embeddings indexed
    const documents = await Promise.all(
      (data ?? []).map(async (row) => {
        const { data: embRow } = await supabase
          .from("embeddings")
          .select("id")
          .eq("document_name", row.name)
          .maybeSingle();

        return {
          name: row.name,
          displayName: row.display_name,
          size: row.size,
          uploadedAt: row.uploaded_at,
          indexed: !!embRow,
        };
      })
    );

    return NextResponse.json(documents);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to list documents: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversationId") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file was provided in the upload request." },
        { status: 400 }
      );
    }

    // Validate extension and mime-type
    const isPdfExtension = file.name.toLowerCase().endsWith(".pdf");
    const isPdfMime = file.type === "application/pdf";

    if (!isPdfExtension || !isPdfMime) {
      return NextResponse.json(
        { error: "Invalid file type. Only PDF documents are allowed." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Build scoped filename: conversationId_originalName
    let safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const displayName = safeFilename;
    if (conversationId) {
      safeFilename = `${conversationId}_${safeFilename}`;
    }

    // Upload to Supabase Storage
    let { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(safeFilename, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    interface ExtendedStorageError {
      message: string;
      status?: number;
      statusCode?: string;
    }

    const err = uploadError as ExtendedStorageError | null;

    // If bucket doesn't exist, attempt to create it and retry upload
    if (
      err &&
      (err.message?.includes("Bucket not found") ||
        err.status === 404 ||
        err.statusCode === "404")
    ) {
      const { error: createError } = await supabase.storage.createBucket(BUCKET, {
        public: false,
        allowedMimeTypes: ["application/pdf"],
      });

      if (!createError) {
        const retryResult = await supabase.storage
          .from(BUCKET)
          .upload(safeFilename, buffer, {
            contentType: "application/pdf",
            upsert: true,
          });
        uploadError = retryResult.error;
      } else {
        uploadError = {
          message: `Bucket not found and auto-creation failed: ${createError.message}`,
        } as unknown as NonNullable<typeof uploadError>;
      }
    }

    if (uploadError) {
      return NextResponse.json(
        { error: `Failed to upload to storage: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Insert metadata row
    const { error: dbError } = await supabase.from("documents").upsert(
      {
        conversation_id: conversationId ?? "default",
        name: safeFilename,
        display_name: displayName,
        size: file.size,
      },
      { onConflict: "name" }
    );

    if (dbError) {
      return NextResponse.json(
        { error: `Failed to save document metadata: ${dbError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      name: safeFilename,
      size: file.size,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to upload document: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { name } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "Missing document name parameter." },
        { status: 400 }
      );
    }

    // Remove PDF from Supabase Storage
    await supabase.storage.from(BUCKET).remove([name]);

    // Delete embeddings row
    await supabase.from("embeddings").delete().eq("document_name", name);

    // Delete metadata row
    const { error } = await supabase.from("documents").delete().eq("name", name);

    if (error) {
      return NextResponse.json(
        { error: `Failed to delete document: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to delete document: ${errorMessage}` },
      { status: 500 }
    );
  }
}
