# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**leetlock** is a Chrome Extension (Manifest V3) that blocks distracting websites until the user completes a LeetCode problem for the day.

## Loading and Testing

No build step — load the extension directly in Chrome:
1. Navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in the top-right)
3. Click "Load unpacked" and select the project directory
4. Changes to JS files require clicking the reload icon on the extension card; HTML/CSS changes may hot-reload

## Architecture

The extension has two main runtime contexts:

**`background.js`** — the service worker (MV3). All core logic lives here:
- Manages blocked site rules via `chrome.declarativeNetRequest.updateDynamicRules()`, redirecting `main_frame` requests to `blocked.html` when the user hasn't unlocked for the day
- Intercepts XHR requests to `leetcode.com/graphql` via `chrome.webRequest.onBeforeRequest` (non-blocking), re-fetches them with cookies, and parses `submissionDetails` responses — a `statusCode` of `10` indicates a successful submission
- Stores state in `chrome.storage.local`: `completedToday` (solved slugs for today), `todayProblems` (today's assigned problems), `unlockedToday` (boolean), `allCompleted` (full history), streak data, and per-set variants
- Loaded via `importScripts('problems.js')` since it runs as a service worker

**`popup.html` / `popup.js`** — the browser action popup. Reads/writes `chrome.storage.local` and sends messages to the background for async operations (e.g., `fetch-problem`).

**`blocked.html` / `blocked.js`** — shown when a banned site is visited and the user hasn't completed their problems. Displays today's problems and a "Continue" button (enabled when all are solved) that calls `history.back()` to return to the original destination.

## Key Details

- Uses `chrome.*` API throughout — do not use `browser.*`
- Manifest V3 uses `declarativeNetRequest` for blocking (not `webRequestBlocking`); rule updates are async via `updateDynamicRules`
- The service worker can be killed and restarted at any time by Chrome; all persistent state must live in `chrome.storage.local`, not in-memory variables (in-memory vars are only used as a cache restored on startup)
- `chrome.runtime.onMessage` listeners must return `true` to keep the channel open for async `sendResponse` — returning a Promise is Firefox-only behavior
- The LeetCode detection works by intercepting the GraphQL request body (requires `requestBody` permission in `webRequest`) and re-issuing it from the extension context with `credentials: 'include'` to read the authenticated response
