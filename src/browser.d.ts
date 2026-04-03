// Minimal type declarations for Firefox WebExtension APIs (Manifest V2)

declare namespace browser {
  namespace storage {
    interface StorageChange { oldValue?: unknown; newValue?: unknown }
    namespace local {
      function get(keys: string | string[]): Promise<Record<string, unknown>>;
      function set(items: Record<string, unknown>): Promise<void>;
    }
    function addListener(callback: (changes: Record<string, StorageChange>) => void): void;
    const onChanged: { addListener: typeof addListener };
  }

  namespace history {
    interface HistoryItem { url?: string; title?: string; visitCount?: number; lastVisitTime?: number }
    function search(query: { text: string; maxResults?: number; startTime?: number }): Promise<HistoryItem[]>;
  }

  namespace bookmarks {
    interface BookmarkTreeNode { url?: string; title?: string }
    function search(query: string): Promise<BookmarkTreeNode[]>;
    function getRecent(count: number): Promise<BookmarkTreeNode[]>;
  }

  namespace tabs {
    interface Tab { id?: number; windowId?: number; title?: string; url?: string }
    function query(queryInfo: Record<string, unknown>): Promise<Tab[]>;
    function update(tabId: number, updateProperties: { active?: boolean; url?: string }): Promise<Tab>;
    function create(createProperties: { url: string }): Promise<Tab>;
  }

  namespace windows {
    function update(windowId: number, updateInfo: { focused?: boolean }): Promise<unknown>;
  }

  namespace runtime {
    interface MessageSender { tab?: browser.tabs.Tab }
    function sendMessage(message: unknown): Promise<unknown>;
    function getURL(path: string): string;
    const onMessage: {
      addListener(callback: (message: never, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean | undefined | void): void;
    };
  }
}
