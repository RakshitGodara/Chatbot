# Rules

## Scope Control

Implement only the current checkpoint.

Do not implement future checkpoints.

---

## Stability

Do not refactor working code.

Do not rename files.

Do not change folder structure unless absolutely necessary.

Preserve existing functionality.

---

## Simplicity

Prefer the simplest working implementation.

Modify the minimum number of files possible.

Do not add dependencies unless required.

---

## Storage Strategy

Use local storage first.

Do not introduce Supabase before Checkpoint 10.

---

## Error Prevention

Before returning code, perform a self-review.

Review for:

* TypeScript errors
* Missing imports
* Invalid imports
* Incorrect file paths
* Runtime issues
* Existing functionality breakage

---

## Mock Build Review

Before returning code:

Assume the following commands will be executed:

npm install

npm run lint

npm run build

Review all modified files and identify likely failures.

Fix issues before returning code.

---

## Assumptions

Do not make assumptions about files that were not provided.

If information is missing, ask questions.

---

## Success Criteria

A checkpoint is complete only when all acceptance criteria are satisfied.
