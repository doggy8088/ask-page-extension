# AskPage Chrome Extension - Copilot Instructions

## Project Overview
AskPage is a Chrome Extension (Manifest V3) that integrates with Google's Gemini AI API to answer questions about web page content. Users can select text or ask questions about entire pages through a modal dialog interface.

## Architecture & Core Components

### 3-Layer Extension Architecture
- **`background.js`**: Service worker handling keyboard shortcuts (`Ctrl+I`) via `chrome.commands` API
- **`content.js`**: Main application logic injected into all web pages, manages the dialog UI and Gemini API communication
- **`popup.js/popup.html`**: Settings interface for Gemini API key configuration

### Key Design Patterns
- **Storage**: Uses `chrome.storage.local` for API keys and prompt history (max 100 items)
- **Messaging**: Background → Content script communication via `chrome.tabs.sendMessage`
- **Security**: DOMPurify sanitizes all AI-generated HTML content before rendering
- **UI State**: Single global `isDialogVisible` flag prevents multiple dialog instances

## Critical Developer Workflows

### Development Commands
```bash
npm run lint          # ESLint with webextensions environment
npm run validate      # Web-ext validation (limited MV3 support)
npm run build         # Full lint + validate + package
npm run package       # Creates dist/ directory with .zip
```

### Testing & Debugging
- Load unpacked extension: Use `dist/` output from `npm run package`
- Console debugging: All logs prefixed with `[AskPage]`
- API testing: Check popup settings if API calls fail

### Release Process
- Git tags trigger GitHub Actions: `git tag v1.0.0 && git push origin v1.0.0`
- Automated CI/CD with quality checks, building, and Chrome Web Store upload
- Manual builds available via GitHub Actions workflow

## Project-Specific Conventions

### Code Style (ESLint enforced)
- **Indentation**: 4 spaces (not 2)
- **Quotes**: Single quotes for strings
- **Globals**: `chrome`, `marked`, `DOMPurify` predefined
- **File-specific rules**: Service worker environment for `background.js`, browser environment for content/popup

### Chinese-First Development
- All user-facing text in Traditional Chinese (zh-TW)
- Comments and variable names may mix English/Chinese
- Gemini API responses forced to Traditional Chinese via system prompt

### Dialog UI Patterns
- **Command System**: `/clear` (history), `/summary` (page summary) with autocomplete
- **History Navigation**: Arrow keys cycle through prompt history
- **Text Selection**: Captured on dialog open, prioritized in AI context
- **Copy Functionality**: All AI responses have copy-to-clipboard buttons

## Integration Points & External Dependencies

### Gemini API Integration
- **Endpoint**: `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17`
- **Context Strategy**: Selected text (5000 chars) + full page (15000 chars) for comprehensive understanding
- **Error Handling**: Network failures show user-friendly errors in dialog

### Third-Party Libraries
- **marked.js**: Markdown parsing for AI responses
- **DOMPurify**: XSS protection for rendered HTML
- **Loading**: Via `lib/` directory, declared in manifest `web_accessible_resources`

### Chrome APIs Usage
- `chrome.storage.local`: Persistent settings and history
- `chrome.commands`: Keyboard shortcut registration
- `chrome.tabs.sendMessage`: Background → content communication
- `activeTab`, `scripting`: Required permissions for content injection

## Theme & Styling
- **CSS Variables**: Theme detection via `@media (prefers-color-scheme: dark)`
- **Z-index Strategy**: Dialog overlay at `2147483647`, intellisense at `2147483648`
- **Font Stack**: System fonts with emoji support fallback

## Common Debugging Points
- **API Key Issues**: Check popup settings, verify API key format
- **Dialog Not Appearing**: Check `isDialogVisible` state, verify content script injection
- **Markdown Rendering**: Ensure marked.js/DOMPurify are loaded before content script
- **History Loss**: Check `chrome.storage.local` quota and error handling

## Bump new version rules

- **Patch Version**: For bug fixes, minor improvements, or documentation updates
- **Minor Version**: For new features, enhancements, or significant changes that do not break existing functionality
- **Major Version**: For breaking changes, API changes, or significant architectural shifts
- Update `CHANGELOG.md` with detailed changes
- Update `package.json` and `manifest.json` with new version number
- Update `README.md` with new features