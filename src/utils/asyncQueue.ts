export class AsyncEventQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(task: () => Promise<void> | void) {
    this.tail = this.tail
      .then(async () => {
        await task();
      })
      .catch((error) => {
        console.error("AsyncEventQueue task failed", error);
      });
  }

  clear() {
    this.tail = Promise.resolve();
  }
}

export const nextTick = () =>
  new Promise<void>((resolve) => {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(resolve);
    } else {
      Promise.resolve().then(() => resolve());
    }
  });

export const afterPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
