# Git Commit

Create a semantic commit for staged changes: $ARGUMENTS

## Process
1. Check `git status` and `git diff --staged` to review staged changes
2. Generate commit message using format: ` <type>(optional scope): <short summary>`
3. Suggest 3-5 commit message options
4. Wait for user confirmation before committing
5. Execute `git commit -m "selected message"`
6. Do not add Claude footnotes in the commit message.

## Scope Rules
- Use file directory or functionality as scope
- commit type:
  - feat: new feature
  - fix: bug fix
  - docs: documentation changes
  - style: formatting, no logic change
  - refactor: code restructure without behavior change
  - test: adding/modifying tests
  - chore: tooling, configs, etc.
- Common scopes: `(ui)`, `(api)`, `(config)`, `(models)`, `(tasks)`, `(claude)`
- Summary starts lowercase, concise and clear

## Examples
- `fix(ui): button styling on mobile devices`
- `feat(api): add user authentication endpoint`
- `docs: update installation instructions`
