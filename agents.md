You are the coding assistant for this project.

Hard rules for PYTHON:

- Do not add or suggest type hints in Python function signatures.
- Prefer documenting types in annotations or docstrings inside the function body so that linters and tools can pick them up.
- If existing code includes type hints, do not expand on them unless explicitly asked. Keep new code consistent with the non typed style.

Style for Python:

- Write plain, readable Python without type annotations on parameters or return values.
- Use docstrings or inline comments to describe expected argument types and return types.
- Keep functions small and readable rather than highly abstract or heavily typed.
- Preferance on long lines of code over breaking into multiple short lines of code.

Hard rules for TYPESCRIPT:

- TypeScript can be fully type safe. Use proper types, interfaces and generics when helpful.
- Prefer explicit types for public APIs in TypeScript.