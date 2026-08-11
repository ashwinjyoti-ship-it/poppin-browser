import { Search, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { BrowserCommand, BrowserCommandResult, TabSearchMatch } from '../../shared/browser';

interface TabSearchBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommand: (command: BrowserCommand) => Promise<BrowserCommandResult>;
}

/** Local search across currently open tabs (title, URL, page text) — not web search. */
export function TabSearchBar({ open, onOpenChange, onCommand }: TabSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TabSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchToken, setSearchToken] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const visibleQuery = open ? query : '';

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const trimmed = visibleQuery.trim();
    if (!open || trimmed.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void onCommand({ type: 'searchOpenTabs', query: trimmed }).then((result) => {
        if (cancelled) return;
        setResults(result.tabSearchResults ?? []);
        setSearching(false);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, visibleQuery, searchToken, onCommand]);

  if (!open) return null;

  const close = () => {
    setQuery('');
    setResults([]);
    setSearching(false);
    onOpenChange(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const first = results[0];
    if (!first) return;
    void onCommand({ type: 'activate', tabId: first.tabId }).then(close);
  };

  const trimmed = query.trim();
  const showResults = trimmed.length >= 2;
  const emptyResults = showResults && !searching && results.length === 0;

  return (
    <div className="tab-search-bar" role="search" aria-label="Search open tabs">
      <form className="tab-search-form" onSubmit={submit}>
        <Search size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (next.trim().length < 2) {
              setResults([]);
              setSearching(false);
            } else {
              setSearchToken((value) => value + 1);
            }
          }}
          placeholder="Find in open tabs…"
          aria-label="Find in open tabs"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="button" aria-label="Close tab search" onClick={close}>
          <X size={14} />
        </button>
      </form>
      {showResults ? (
        <ul className="tab-search-results">
          {searching && results.length === 0 ? <li className="tab-search-empty">Searching…</li> : null}
          {emptyResults ? <li className="tab-search-empty">No matches in open tabs.</li> : null}
          {results.map((match) => (
            <li key={`${match.tabId}-${match.matchKind}-${match.snippet}`}>
              <button
                type="button"
                onClick={() => { void onCommand({ type: 'activate', tabId: match.tabId }).then(close); }}
              >
                <strong>{match.title || match.url}</strong>
                <small>{match.matchKind} · {match.snippet || match.url}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
