# SDK Dev Server Configuration Page

## Summary

Replace the bare SDK dev server page (`apps/sdk/src/index.html`) with a full configuration panel that supports two modes: **Mock mode** (JSON-driven, no backend needed) and **Live mode** (connects to real API). This enables rapid widget iteration without round-tripping to the database.

## Problem

The current dev page shows only a title and the widget button with a hardcoded SDK ID. Developers must modify `index.html` or update the database to test different configurations. There's no way to quickly iterate on appearance, content, or feature flags.

## Design

### Component Change

Add one prop to `smc-chat-widget.tsx`:

```typescript
@Prop() mockConfig?: string;
```

- Type: JSON string representing `SdkWidgetConfig`
- When present: widget parses the JSON and uses it directly, skipping the API fetch
- When absent: widget boots normally (existing behavior unchanged)

### Dev Page Layout

Two-mode toggle at the top:

**Mock mode (default):**
- JSON textarea pre-filled with a complete `SdkWidgetConfig` default
- "Apply Config" button — destroys and re-creates the widget element with updated JSON
- "Reset to Defaults" button — restores textarea to the default JSON

**Live mode:**
- SDK ID text input
- API URL text input (defaults to `http://localhost:3005`)
- "Connect" button — re-creates widget with `sdk-id` and `api-url` attributes

Widget renders below the config panel in a preview area.

### Default Mock JSON

```json
{
  "agentId": "agent_demo_001",
  "apiKeyPrefix": "sk_demo",
  "theme": "light",
  "primaryColor": "#6366f1",
  "secondaryColor": "#e0e7ff",
  "position": "right",
  "headerText": "Chat with us",
  "headerIcon": null,
  "botName": "Assistant",
  "botAvatar": null,
  "welcomeMessage": "Hello! How can I help you today?",
  "inputPlaceholder": "Type your message...",
  "preChatForm": null,
  "quickReplies": ["What can you do?", "Help me get started"],
  "proactiveRules": null,
  "kbEnabled": false,
  "fileUpload": false,
  "csatEnabled": false,
  "csatType": "thumbs"
}
```

### Behavior

1. Page loads in Mock mode with default JSON applied to the widget
2. Editing JSON + clicking "Apply Config" destroys the current `<smc-chat-widget>` element and creates a new one with `mock-config` set to the textarea value
3. Switching to Live mode removes `mock-config` and sets `sdk-id` + `api-url` attributes instead
4. "Reset to Defaults" restores the textarea content to the default JSON
5. JSON validation: if the textarea contains invalid JSON, show an inline error and don't apply

### Technical Constraints

- Dev page is plain HTML + vanilla JS (no framework, no build step beyond Stencil)
- Styling: minimal, dark theme to match the current page aesthetic
- The `mockConfig` prop is kebab-cased as `mock-config` in HTML attributes
- Widget re-creation (remove + append) is necessary because Stencil props set at creation time drive `componentWillLoad()`

### Files Changed

1. `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx` — add `mockConfig` prop, modify boot logic
2. `apps/sdk/src/index.html` — full rewrite with config panel UI

### Future Extensibility

When a new field is added to `SdkWidgetConfig` and the bootstrap API response, the only change needed on the dev page is updating the default JSON object. No new UI controls or props required.
