import { NextResponse } from 'next/server';

const GONE = { error: 'This endpoint has been removed. Configure Bedrock credentials per-provider on the LLM Providers page (/transcription/llm-providers).' };

/** @deprecated Caller-bucket S3 access removed. Bedrock creds are now per-provider. */
export function GET() { return NextResponse.json(GONE, { status: 410 }); }
export function PUT() { return NextResponse.json(GONE, { status: 410 }); }
export function DELETE() { return NextResponse.json(GONE, { status: 410 }); }
