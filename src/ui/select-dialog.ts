import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  fuzzyFilter,
  getEditorKeybindings,
  Input,
  SelectList,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
  type SelectItem,
} from "@mariozechner/pi-tui";

type DialogTheme = Pick<ExtensionContext["ui"]["theme"], "fg" | "bg" | "bold">;

export interface SelectDialogItem {
  value: string;
  label: string;
  description?: string;
}

export interface SelectDialogOptions {
  title: string;
  items: SelectDialogItem[];
  initialValue?: string;
  pageSize?: number;
  searchable?: boolean;
  emptyLabel?: string;
}

export async function openSelectDialog(
  ctx: ExtensionContext,
  options: SelectDialogOptions
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    return new CompactSelectDialog(theme, options, {
      onDone: done,
      requestRender: () => tui.requestRender(),
    });
  });
}

class CompactSelectDialog implements Component, Focusable {
  private readonly searchInput?: Input;
  private readonly pageSize: number;
  private readonly searchable: boolean;
  private readonly emptyLabel: string;
  private readonly allItems: SelectItem[];
  private readonly title: string;
  private readonly onDone: (value: string | undefined) => void;
  private readonly requestRender: () => void;

  private filteredItems: SelectItem[];
  private selectList: SelectList;
  private selectedValue: string | undefined;
  private selectedIndex = 0;
  private pageIndex = 0;
  private searchVisible = false;
  private _focused = false;

  constructor(
    private readonly theme: DialogTheme,
    options: SelectDialogOptions,
    callbacks: {
      onDone: (value: string | undefined) => void;
      requestRender: () => void;
    }
  ) {
    this.title = options.title;
    this.onDone = callbacks.onDone;
    this.requestRender = callbacks.requestRender;
    this.allItems = options.items.map((item) => ({ ...item }));
    this.filteredItems = this.allItems;
    this.searchable = options.searchable ?? false;
    this.pageSize = Math.max(1, options.pageSize ?? this.allItems.length);
    this.emptyLabel = options.emptyLabel ?? "  No matching items";
    this.selectedValue = options.initialValue;

    if (this.searchable) {
      this.searchInput = new Input();
    }

    if (this.selectedValue) {
      const selectedIndex = this.allItems.findIndex((item) => item.value === this.selectedValue);
      if (selectedIndex >= 0) {
        this.selectedIndex = selectedIndex;
        this.pageIndex = Math.floor(selectedIndex / this.pageSize);
      }
    }

    this.selectList = this.createSelectList();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (this.searchInput) {
      this.searchInput.focused = value && this.searchVisible;
    }
  }

  invalidate(): void {
    this.selectList.invalidate();
    this.searchInput?.invalidate();
  }

  render(width: number): string[] {
    const lines = [this.theme.fg("accent", this.theme.bold(this.title))];

    if (
      this.searchable &&
      this.searchInput &&
      (this.searchVisible || this.searchInput.getValue())
    ) {
      const prefix = this.theme.fg("dim", "  / ");
      const prefixWidth = visibleWidth(prefix);
      const inputLine = this.searchInput.render(Math.max(1, width - prefixWidth))[0] ?? "";
      lines.push(prefix + inputLine);
    }

    if (this.getVisibleItems().length === 0) {
      lines.push(this.theme.fg("warning", truncateToWidth(this.emptyLabel, width)));
    } else {
      lines.push(...this.selectList.render(width));
    }

    lines.push(this.theme.fg("dim", truncateToWidth(this.buildMetaLine(), width)));
    lines.push(this.theme.fg("dim", truncateToWidth(this.buildHelpLine(), width)));
    return lines;
  }

  handleInput(data: string): void {
    const kb = getEditorKeybindings();

    if (this.searchable && !this.searchVisible && data === "/") {
      this.searchVisible = true;
      if (this.searchInput) {
        this.searchInput.focused = this.focused;
      }
      this.requestRender();
      return;
    }

    if (kb.matches(data, "selectPageUp")) {
      this.movePage(-1);
      return;
    }

    if (kb.matches(data, "selectPageDown")) {
      this.movePage(1);
      return;
    }

    if (this.searchVisible && this.searchInput) {
      if (kb.matches(data, "selectCancel")) {
        if (this.searchInput.getValue()) {
          this.searchInput.setValue("");
          this.applyFilter("");
        } else {
          this.searchVisible = false;
          this.searchInput.focused = false;
          this.requestRender();
        }
        return;
      }

      if (!isNavigationKey(data, kb)) {
        this.searchInput.handleInput(data);
        this.applyFilter(this.searchInput.getValue());
        return;
      }
    }

    if (this.getVisibleItems().length === 0) {
      if (kb.matches(data, "selectCancel")) {
        this.onDone(undefined);
      }
      return;
    }

    if (kb.matches(data, "selectCancel")) {
      this.onDone(undefined);
      return;
    }

    if (kb.matches(data, "selectUp")) {
      this.moveSelection(-1);
      return;
    }

    if (kb.matches(data, "selectDown")) {
      this.moveSelection(1);
      return;
    }

    if (kb.matches(data, "selectConfirm")) {
      this.onDone(this.filteredItems[this.selectedIndex]?.value);
    }
  }

  private createSelectList(): SelectList {
    const items = this.getVisibleItems();
    const list = new SelectList(items, Math.max(1, Math.min(items.length, this.pageSize)), {
      selectedPrefix: (text) => this.highlightSelected(text),
      selectedText: (text) => this.highlightSelected(text),
      description: (text) => this.theme.fg("muted", text),
      scrollInfo: (text) => this.theme.fg("dim", text),
      noMatch: (text) => this.theme.fg("warning", text),
    });

    if (items.length === 0) {
      this.selectedValue = undefined;
      this.selectedIndex = 0;
      return list;
    }

    const pageStart = this.pageIndex * this.pageSize;
    const localIndex = Math.max(0, Math.min(this.selectedIndex - pageStart, items.length - 1));
    this.selectedIndex = pageStart + localIndex;
    this.selectedValue = this.filteredItems[this.selectedIndex]?.value;
    list.setSelectedIndex(localIndex);
    return list;
  }

  private applyFilter(query: string): void {
    const trimmedQuery = query.trim();
    this.filteredItems = trimmedQuery
      ? fuzzyFilter(this.allItems, trimmedQuery, (item) =>
          [item.label, item.value, item.description ?? ""].join(" ")
        )
      : this.allItems;

    const preferredValue = this.selectedValue;
    const nextIndex = preferredValue
      ? this.filteredItems.findIndex((item) => item.value === preferredValue)
      : -1;
    this.selectedIndex = nextIndex >= 0 ? nextIndex : 0;
    this.pageIndex = Math.floor(this.selectedIndex / this.pageSize);
    this.selectList = this.createSelectList();
    this.requestRender();
  }

  private moveSelection(delta: number): void {
    if (this.filteredItems.length === 0) {
      return;
    }

    this.selectedIndex =
      (this.selectedIndex + delta + this.filteredItems.length) % this.filteredItems.length;
    this.selectedValue = this.filteredItems[this.selectedIndex]?.value;
    this.pageIndex = Math.floor(this.selectedIndex / this.pageSize);
    this.selectList = this.createSelectList();
    this.requestRender();
  }

  private movePage(delta: number): void {
    const pageCount = this.getPageCount();
    if (pageCount <= 1) {
      return;
    }

    const localIndex = this.selectedIndex - this.pageIndex * this.pageSize;
    this.pageIndex = (this.pageIndex + delta + pageCount) % pageCount;
    this.selectedIndex = Math.min(
      this.pageIndex * this.pageSize + localIndex,
      this.filteredItems.length - 1
    );
    this.selectedValue = this.filteredItems[this.selectedIndex]?.value;
    this.selectList = this.createSelectList();
    this.requestRender();
  }

  private getPageCount(): number {
    return Math.max(1, Math.ceil(this.filteredItems.length / this.pageSize));
  }

  private getVisibleItems(): SelectItem[] {
    const start = this.pageIndex * this.pageSize;
    return this.filteredItems.slice(start, start + this.pageSize);
  }

  private highlightSelected(text: string): string {
    return this.theme.bg("selectedBg", this.theme.fg("text", this.theme.bold(text)));
  }

  private buildMetaLine(): string {
    const parts = [] as string[];
    if (this.getPageCount() > 1) {
      parts.push(`Page ${this.pageIndex + 1}/${this.getPageCount()}`);
    }
    parts.push(`${this.filteredItems.length} item${this.filteredItems.length === 1 ? "" : "s"}`);
    if (this.searchable) {
      const query = this.searchInput?.getValue() ?? "";
      parts.push(query ? `search: ${query}` : "/ search");
    }
    return `  ${parts.join(" · ")}`;
  }

  private buildHelpLine(): string {
    const parts = ["↑↓ move"];
    if (this.getPageCount() > 1) {
      parts.push("PgUp/PgDn pages");
    }
    if (this.searchable) {
      parts.push("/ search");
    }
    parts.push("Enter select", "Esc cancel");
    return `  ${parts.join(" · ")}`;
  }
}

function isNavigationKey(data: string, kb: ReturnType<typeof getEditorKeybindings>): boolean {
  return (
    kb.matches(data, "selectUp") ||
    kb.matches(data, "selectDown") ||
    kb.matches(data, "selectPageUp") ||
    kb.matches(data, "selectPageDown") ||
    kb.matches(data, "selectConfirm")
  );
}
