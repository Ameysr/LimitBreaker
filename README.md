# QueuePilot

Never lose your AI workflow to rate limits. Queue prompts, auto-submit when limits reset, stay productive.

## What it does

QueuePilot is a Chrome extension that monitors AI web apps (Claude, ChatGPT, Gemini) for rate limits. When you get rate limited, instead of leaving and coming back, you queue your prompts and QueuePilot automatically submits them when your limit resets.

## Features

- **Rate Limit Detection** — Automatically detects when you hit usage limits on Claude.ai, ChatGPT, and Gemini
- **Prompt Queue** — Queue multiple prompts and they get submitted in order
- **Auto Submit** — Prompts are automatically submitted when your limit resets
- **Browser Notifications** — Get notified when limits hit, clear, or queue completes
- **Pause/Resume** — Full control over queue processing
- **Settings** — Configure notifications and auto-submit behavior
- **Queue History** — Track completed submissions

## Supported Platforms

| Platform | URL | Status |
|----------|-----|--------|
| Claude | claude.ai | Supported |
| ChatGPT | chatgpt.com | Supported |
| Gemini | gemini.google.com | Supported |

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `queuepilot` folder
6. The QueuePilot icon appears in your toolbar

## How to Use

1. Navigate to any supported AI platform
2. QueuePilot automatically starts monitoring
3. When you hit a rate limit, click the QueuePilot icon
4. Type your prompts and click **Add to Queue**
5. QueuePilot watches for the limit to reset
6. When it resets, your prompts are submitted automatically
7. You get a notification when everything is done

## Tech Stack

- JavaScript (Vanilla)
- Chrome Extension Manifest V3
- Chrome Storage API
- Chrome Notifications API
- Chrome Alarms API

## Project Structure

```
queuepilot/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── background/
│   └── service-worker.js
├── content-scripts/
│   ├── detector.js
│   ├── injector.js
│   └── platforms/
│       ├── claude.js
│       ├── chatgpt.js
│       └── gemini.js
├── utils/
│   ├── storage.js
│   └── messaging.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## License

MIT
