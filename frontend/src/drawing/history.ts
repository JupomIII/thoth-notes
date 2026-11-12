export interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Bounded undo/redo stack used by the drawing engine. */
export class HistoryStack {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private applying = false;
  private listeners = new Set<() => void>();

  constructor(private readonly limit = 120) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get isApplying(): boolean {
    return this.applying;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  push(entry: HistoryEntry): void {
    if (this.applying) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.emit();
  }

  async undo(): Promise<boolean> {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.applying = true;
    try {
      await entry.undo();
    } finally {
      this.applying = false;
    }
    this.redoStack.push(entry);
    this.emit();
    return true;
  }

  async redo(): Promise<boolean> {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.applying = true;
    try {
      await entry.redo();
    } finally {
      this.applying = false;
    }
    this.undoStack.push(entry);
    this.emit();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  labels(): { undo: string | null; redo: string | null } {
    return {
      undo: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redo: this.redoStack[this.redoStack.length - 1]?.label ?? null,
    };
  }
}
