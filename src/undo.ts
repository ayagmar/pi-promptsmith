export class UndoManager {
  private previousDraft: string | undefined;

  store(draft: string): void {
    this.previousDraft = draft;
  }

  hasUndo(): boolean {
    return this.previousDraft !== undefined;
  }

  consume(): string | undefined {
    const draft = this.previousDraft;
    this.previousDraft = undefined;
    return draft;
  }

  clear(): void {
    this.previousDraft = undefined;
  }
}
