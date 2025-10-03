---
description: Generate git commit summary and description for current changes
auto_execution_mode: 3
---

# Git Commit Info Workflow

This workflow automatically analyzes all changes since the last git commit and generates a comprehensive commit message. All steps run automatically without requiring user confirmation.

## Automated Steps

// turbo
1. **Get last commit information**
   ```bash
   git log -1 --pretty=format:"%H %s %cr"
   ```

// turbo
2. **Check current git status**
   ```bash
   git status --short
   ```

// turbo
3. **Review all changes since last commit**
   ```bash
   git diff HEAD
   ```

// turbo
4. **List all modified files**
   ```bash
   git diff --name-status HEAD
   ```

5. **Analyze conversation context**
   - Review all conversations since last commit
   - Identify what features/fixes were discussed
   - Determine current work state (complete vs work-in-progress)

6. **Generate commit message**
   - Create summary using conventional commit format: `type(scope): description`
   - Common types: feat, fix, docs, style, refactor, test, chore, wip
   - Keep summary under 72 characters
   - Use imperative mood (e.g., "add", "fix", "update")
   - If work is incomplete, prefix with "wip:" or include "[WIP]"

7. **Generate detailed description**
   - Explain what was accomplished and why
   - List all modified files with brief explanations
   - Note current state (complete, partial, in-progress)
   - Include any breaking changes or important notes
   - Mention known issues or next steps if work is incomplete

## Output Format

Provides a ready-to-copy commit message formatted for GitHub Desktop:

**Commit Summary:** (single line, ≤72 chars)
**Commit Description:** (detailed multi-line description)

## Notes

- All steps execute automatically without user confirmation
- Detects work-in-progress state and reflects it in commit message
- Analyzes both code changes and conversation context
- Output is formatted for direct copy-paste into GitHub Desktop