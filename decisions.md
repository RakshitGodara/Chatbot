# Architecture Decisions

## Architecture

Current:
Single Next.js application

Reason:
Fastest path to MVP

---

## AI Provider

Current:
OpenAI

Reason:
Single provider reduces complexity

---

## Persistence

<!-- Current:
Local JSON files -->

<!-- Reason:
Simplest development workflow -->

Current: Supabase PostgreSQL
Reason: Scalable and reliable data storage

<!-- Future:
Supabase PostgreSQL -->

Migration Trigger:
Checkpoint 10

---

## Vector Storage

Current:
Local storage

Future:
pgvector in Supabase

Migration Trigger:
Production-ready RAG

---

## Development Strategy

MVP First
→ Validate
→ Add Feature
→ Refactor On Pain

This decision overrides architecture preferences.
