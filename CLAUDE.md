# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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