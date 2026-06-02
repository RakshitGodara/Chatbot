# AI Document Chat

## Goal

Build an AI chatbot that supports:

* General AI chat
* PDF upload
* PDF-only mode
* PDF + AI mode
* Source citations
* Conversation history
* Multiple PDF support

## Development Philosophy

MVP First
→ Validate
→ Add Features
→ Refactor On Pain

## Current Storage

Local filesystem and JSON files.

## Future Storage

Supabase PostgreSQL + pgvector.

Migration will happen only after the application works end-to-end locally.

## Tech Stack

Frontend:

* Next.js
* TypeScript
* Tailwind CSS

AI:

* OpenAI

Current Persistence:

* Local JSON

Future Persistence:

* Supabase

Deployment:

* Local initially
* Vercel later

## Non-Goals

Do not build:

* Authentication
* Billing
* Teams
* Multi-model support
* Advanced analytics

until the core chatbot works.
