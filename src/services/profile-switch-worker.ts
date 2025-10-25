type SwitchTask = {
  profile: string;
  notifySuccess: boolean;
  run: () => Promise<void>;
};

export type SwitchWorkerEvent =
  | { type: "start"; profile: string; notifySuccess: boolean }
  | { type: "queued"; profile: string; notifySuccess: boolean }
  | { type: "success"; profile: string; notifySuccess: boolean }
  | { type: "error"; profile: string; error: string }
  | { type: "idle" };

type Listener = (event: SwitchWorkerEvent) => void;

const listeners = new Set<Listener>();

let currentTask: SwitchTask | null = null;
let pendingTask: SwitchTask | null = null;
let running = false;

const emit = (event: SwitchWorkerEvent) => {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error("[ProfileSwitchWorker] Listener error:", error);
    }
  });
};

const runCurrentTask = async () => {
  if (!currentTask) {
    emit({ type: "idle" });
    return;
  }

  running = true;
  const { profile, notifySuccess, run } = currentTask;
  emit({ type: "start", profile, notifySuccess });

  try {
    await run();
    emit({ type: "success", profile, notifySuccess });
  } catch (error: any) {
    const message = error?.message || String(error);
    emit({ type: "error", profile, error: message });
  } finally {
    running = false;
    currentTask = null;
    if (pendingTask) {
      currentTask = pendingTask;
      pendingTask = null;
      queueMicrotask(runCurrentTask);
    } else {
      emit({ type: "idle" });
    }
  }
};

export const enqueueSwitchTask = (task: SwitchTask) => {
  if (running) {
    pendingTask = task;
    emit({
      type: "queued",
      profile: task.profile,
      notifySuccess: task.notifySuccess,
    });
    return;
  }

  currentTask = task;
  runCurrentTask();
};

export const subscribeSwitchWorker = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSwitchWorkerSnapshot = () => ({
  switching: currentTask?.profile ?? null,
  queued: pendingTask?.profile ?? null,
  running,
});
