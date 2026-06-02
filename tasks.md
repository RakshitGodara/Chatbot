# Checkpoints

## Checkpoint 1

Basic Chat UI

Acceptance Criteria:

* Chat page renders
* Input box works
* Send button works
* Static response shown

---

## Checkpoint 2

OpenAI Chat Integration

Acceptance Criteria:

* User sends message
* OpenAI responds
* No persistence

---

## Checkpoint 3

Local Conversation Persistence

Acceptance Criteria:

* Conversations stored locally
* Conversations reload after refresh

---

## Checkpoint 4

PDF Upload

Acceptance Criteria:

* Upload PDF
* Validate PDF
* Store file locally

---

## Checkpoint 5

PDF Text Extraction

Acceptance Criteria:

* Extract text from uploaded PDF
* Display extracted text
* No embeddings
* No vector search

---

## Checkpoint 6

Embeddings

Acceptance Criteria:

* Generate embeddings
* Store embeddings locally
* Verify embeddings created

---

## Checkpoint 7

Document Retrieval

Acceptance Criteria:

* Retrieve relevant chunks
* Return matching chunks
* No AI answer generation

---

## Checkpoint 8

PDF Question Answering

Acceptance Criteria:

* User asks question
* Retrieval runs
* Relevant chunks passed to model
* Model answers from retrieved context

---

## Checkpoint 9

Citations

Acceptance Criteria:

* Show document name
* Show page number
* Show source references

---

## Checkpoint 10

Supabase Migration

Acceptance Criteria:

* Conversations moved to Supabase
* Documents moved to Supabase
* Embeddings moved to Supabase
* Existing functionality preserved
