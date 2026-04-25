# AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.

## Project Overview

This is a Chrome extension called "頁問" (AskPage) that integrates with the Gemini AI API to answer questions about the current web page. The extension uses Manifest V3 and is written in vanilla JavaScript with no build framework.

## Development Commands

### Code Quality & Linting
```bash
# Run ESLint to check code style
npm run lint

# Auto-fix ESLint issues
npm run lint:fix

# Validate extension structure (limited Manifest V3 support)
npm run validate
```

### Building & Packaging
```bash
# Complete build process (lint + validate + package)
npm run build

# Create distribution package
npm run package

# Run extension in development mode
npm run dev

# Clean build artifacts
npm run clean
```

### Testing
```bash
# Currently no automated tests
npm test
```

## Architecture Overview

### Core Components

1. **Manifest V3 Structure** (`manifest.json`)
   - Service worker background script
   - Content script injection
   - Popup action interface
   - Keyboard shortcuts (Ctrl+I/MacCtrl+I)

2. **Background Script** (`background.js`)
   - Handles keyboard command events
   - Sends messages to content script to toggle dialog

3. **Content Script** (`content.js`)
   - Main dialog UI creation and management
   - Gemini API integration
   - Text selection handling
   - Command system (`/clear`, `/summary`)
   - Prompt history management
   - Markdown rendering with DOMPurify sanitization

4. **Popup Interface** (`popup.js`, `popup.html`)
   - API key configuration
   - Settings management via Chrome storage API

### Key Features

- **AI Integration**: Uses Gemini 2.5 Flash Lite API for question answering
- **Text Selection**: Automatically detects selected text for contextual questions
- **Command System**: Built-in commands for clearing history and summarizing pages
- **History Management**: Stores and navigates through prompt history
- **Markdown Support**: Renders AI responses as formatted markdown
- **Keyboard Navigation**: Arrow keys for command completion and history browsing

### External Dependencies

- `marked.min.js` - Markdown parsing
- `purify.min.js` - HTML sanitization
- Chrome Extension APIs (storage, tabs, scripting)
- Gemini API (generativelanguage.googleapis.com)

## Code Style & Configuration

### ESLint Configuration
- Uses single quotes, semicolons, 4-space indentation
- Configured for Chrome extension environment
- Globals defined for Chrome APIs, marked, and DOMPurify
- Special rules for different file types (background, content, popup)

### File Structure
```
├── manifest.json          # Extension manifest
├── background.js          # Service worker
├── content.js            # Content script (main functionality)
├── popup.html/popup.js   # Settings popup
├── style.css             # Dialog styling
├── icons/                # Extension icons
├── lib/                  # External libraries
└── dist/                 # Build output
```

## Development Notes

### API Key Storage
- Uses Chrome storage API (`chrome.storage.local`)
- Key stored as `GEMINI_API_KEY`
- Prompt history stored as `ASKPAGE_PROMPT_HISTORY`

### Dialog System
- Creates overlay with fixed positioning
- Uses CSS custom properties for theming
- Handles escape key and click-outside closing
- Prevents multiple dialog instances

### Gemini API Integration
- Uses `gemini-2.5-flash-lite` and `gemini-flash-lite-latest` models (default is `gemini-flash-lite-latest`)
- Includes both full page content and selected text context
- Responses default to Traditional Chinese (zh-tw)
- 15000 character limit for page content, 5000 for selections

### Publishing
- Automated CI/CD via GitHub Actions
- Chrome Web Store integration available
- Version management through git tags
- See `PUBLISH.md` for detailed publishing instructions

## Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
