---
description: Generate git commit summary and description for current changes
---

# Git Commit Info Workflow

This workflow analyzes current git changes and generates proper commit messages following conventional commit format. Use with GitHub Desktop or other git clients.

## Steps

1. **Check git status**
   ```bash
   git status
   ```

2. **Review changes (if needed)**
   ```bash
   git diff --cached  # for staged changes
   git diff           # for unstaged changes
   ```

3. **Generate commit summary**
   - Use conventional commit format: `type(scope): description`
   - Common types: feat, fix, docs, style, refactor, test, chore
   - Keep summary under 50 characters
   - Use imperative mood (e.g., "add", "fix", "update")

4. **Generate commit description**
   - Explain what and why, not how
   - Include breaking changes if any
   - List modified files
   - Mention benefits/impact

## Output Format

Provides ready-to-use commit summary and description for GitHub Desktop or other git clients.

## Example Output

**Summary:**
```
feat: add user authentication system
```

**Description:**
```
Implement JWT-based authentication with login/logout functionality.
Add middleware for protected routes and session management.

Changes:
- auth.js: JWT token generation and validation
- middleware/auth.js: Route protection middleware
- routes/user.js: Login/logout endpoints
- package.json: Add jsonwebtoken dependency

Benefits:
- Secure user sessions
- Protected API endpoints
- Scalable authentication system
```
