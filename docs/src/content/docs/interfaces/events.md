---
title: Events
description: Send events from main process to renderer.
order: 3
---

Events allow the main process to push data to renderer processes. They're useful for notifications, real-time updates, and system events.

## Defining Events

Use the `[Event]` attribute on a method to define an event:

```eipc
[RendererAPI]
[ContextBridge]
interface Notifications {
  // Regular method
  getUnreadCount() -> number

  // Event - main can dispatch this to renderer
  [Event]
  newNotification(title: string, body: string)

  [Event]
  notificationCleared(id: number)
}
```

Events don't have return types — they're one-way from main to renderer.

## Dispatching Events

In the main process, use the dispatcher to send events:

```typescript
import { Notifications } from '../ipc/browser/MyApp';

// Set up implementation and get dispatcher
const dispatcher = Notifications.for(mainWindow.webContents).setImplementation({
  async getUnreadCount() {
    return unreadNotifications.length;
  },
});

// Dispatch events to this window
dispatcher.dispatchNewNotification('New Message', 'You have a new message from John');
dispatcher.dispatchNotificationCleared(123);
```

### Event Naming

The schema event name is used to generate both the dispatch method and the listener:

| Schema Event | Dispatch Method | Renderer Listener |
|--------------|-----------------|-------------------|
| `newNotification` | `dispatchNewNotification` | `onNewNotification` |
| `dataChanged` | `dispatchDataChanged` | `onDataChanged` |
| `shutdown` | `dispatchShutdown` | `onShutdown` |

## Listening to Events

In the renderer, import the interface and subscribe to events using the auto-generated `on` + EventName methods:

```typescript
import { Notifications } from '../ipc/renderer/MyApp';

// Subscribe to events
Notifications.onNewNotification((title, body) => {
  console.log(`New notification: ${title} - ${body}`);
  showNotificationToast(title, body);
});

Notifications.onNotificationCleared((id) => {
  console.log(`Notification ${id} cleared`);
  removeFromList(id);
});
```

### Unsubscribing

The subscription returns an unsubscribe function:

```typescript
const unsubscribe = Notifications.onNewNotification((title, body) => {
  console.log(`New notification: ${title}`);
});

// Later, stop listening
unsubscribe();
```

### React Integration

Since event listeners return an unsubscribe function, they work perfectly with React's `useEffect` cleanup:

```tsx
import { useEffect, useState } from 'react';
import { Notifications } from '../ipc/renderer/MyApp';

function NotificationToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    return Notifications.onNewNotification((title, body) => {
      setMessage(`${title}: ${body}`);
    });
  }, []);

  if (!message) return null;
  return <div className="toast">{message}</div>;
}
```

The unsubscribe function is returned directly from `useEffect`, so React automatically cleans up the listener when the component unmounts.

## Event Arguments

Events can have any number of typed arguments:

```eipc
[RendererAPI]
[ContextBridge]
interface System {
  [Event]
  shutdown()

  [Event]
  error(code: number, message: string)

  [Event]
  progress(taskId: string, percent: number, status: Status)

  [Event]
  dataReceived(data: ComplexData)
}
```

## Real-World Examples

### Download Progress

```eipc
structure DownloadProgress {
  id: string
  filename: string
  bytesReceived: number
  totalBytes: number
  percent: number
}

[RendererAPI]
[ContextBridge]
interface Downloads {
  startDownload(url: string) -> string
  cancelDownload(id: string)

  [Event]
  progress(progress: DownloadProgress)

  [Event]
  complete(id: string, filePath: string)

  [Event]
  error(id: string, error: string)
}
```

Main process:

```typescript
const dispatcher = Downloads.for(webContents).setImplementation({
  async startDownload(url) {
    const id = generateId();

    downloadFile(url, {
      onProgress: (bytes, total) => {
        dispatcher.dispatchProgress({
          id,
          filename: path.basename(url),
          bytesReceived: bytes,
          totalBytes: total,
          percent: (bytes / total) * 100,
        });
      },
      onComplete: (filePath) => {
        dispatcher.dispatchComplete(id, filePath);
      },
      onError: (error) => {
        dispatcher.dispatchError(id, error.message);
      },
    });

    return id;
  },
  // ...
});
```

Renderer:

```typescript
import { Downloads } from '../ipc/renderer/MyApp';

const downloadId = await Downloads.startDownload('https://example.com/file.zip');

Downloads.onProgress((progress) => {
  if (progress.id === downloadId) {
    updateProgressBar(progress.percent);
  }
});

Downloads.onComplete((id, filePath) => {
  if (id === downloadId) {
    showSuccess(`Downloaded to ${filePath}`);
  }
});
```

### Window State

```eipc
enum WindowState {
  Normal
  Minimized
  Maximized
  Fullscreen
}

[RendererAPI]
[ContextBridge]
interface Window {
  getState() -> WindowState

  [Event]
  stateChanged(state: WindowState)

  [Event]
  focusChanged(focused: boolean)
}
```

Main process:

```typescript
const dispatcher = Window.for(win.webContents).setImplementation({
  async getState() {
    if (win.isFullScreen()) return 'Fullscreen';
    if (win.isMaximized()) return 'Maximized';
    if (win.isMinimized()) return 'Minimized';
    return 'Normal';
  },
});

win.on('maximize', () => dispatcher.dispatchStateChanged('Maximized'));
win.on('unmaximize', () => dispatcher.dispatchStateChanged('Normal'));
win.on('minimize', () => dispatcher.dispatchStateChanged('Minimized'));
win.on('focus', () => dispatcher.dispatchFocusChanged(true));
win.on('blur', () => dispatcher.dispatchFocusChanged(false));
```

## Events vs Stores

Use **Events** when:
- You need to notify about discrete occurrences
- Multiple events can happen over time
- Subscribers need to react to each occurrence

Use **Stores** when:
- You have a single piece of state that changes
- You want React integration with hooks
- You need the current value, not just changes

## Next Steps

- [Stores](/ipc/docs/interfaces/stores) — Reactive state with React hooks
- [Validators](/ipc/docs/schema-language/validators) — Secure your events
