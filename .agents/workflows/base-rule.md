---
description: Agent System Constraints & Harness Guidelines
---

# Agent System Constraints & Harness Guidelines

## 1. System Architecture & Objective
- This application allows users to upload custom document files and execute processing on demand.
- When the execution button is triggered, the system calls the **Upstage AI-OCR API** and parses the resulting output as JSON.
- The ultimate goal is to robustly handle **arbitrary, dynamically uploaded files** beyond pre-existing mock datasets.

## 2. Role of Sample Data
- Files such as `sample1.json` through `sample4.json` (and any related test fixtures) are strictly reference examples for demonstration and testing purposes.
- These sample files represent only a subset of potential inputs; system logic must remain generalized.

## 3. Strict Development Guardrails (Never Violate)
- **DO NOT MODIFY SAMPLE FILES:** Under no circumstances should the agent create, edit, or overwrite `sample1.json` ~ `sample4.json` or mock result fixtures to make tests pass superficially.
- **NO HARDCODED / SPECIALIZED LOGIC:** Do not implement narrow logic, heuristics, or hardcoded mapping tailored exclusively to match the sample files.
- **ROOT-CAUSE FIXES ONLY:** When schema mismatches or parsing bugs occur, refine the OCR response parser, error handling, or schema adapter layer rather than altering expected input/output mock datasets.