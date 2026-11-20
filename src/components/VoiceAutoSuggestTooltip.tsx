import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Command, CornerDownLeft, Mic, X } from 'lucide-react';
import type { AutoSuggestItem, WorkspaceTab } from '../utils/voiceSuggestions';

const TAB_LABELS: Record<WorkspaceTab, string> = {
  counter: 'Counter Workspace',
  khata: 'Khata & Stock',
  approvals: 'Owner Approvals',
  performance: 'Performance',
  insights: 'Insights & Audit',
};

interface InlineAutoSuggestTooltipProps {
  open: boolean;
  activeTab: WorkspaceTab;
  hasRecentHistory: boolean;
  isConnected: boolean;
  suggestions: AutoSuggestItem[];
  highlightedIndex: number;
  onHighlight: (idx: number) => void;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export const InlineAutoSuggestTooltip: React.FC<InlineAutoSuggestTooltipProps> = ({
  open,
  activeTab,
  hasRecentHistory,
  isConnected,
  suggestions,
  highlightedIndex,
  onHighlight,
  onSelect,
  onClose,
}) => {
  if (!open || suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Context-aware voice command suggestions"
      className="absolute left-0 right-0 bottom-full mb-2 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
    >
      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-[11px] text-slate-600">
        <span className="font-medium text-slate-800 truncate">
          Auto-Suggest · {TAB_LABELS[activeTab]}
          {hasRecentHistory ? ' · Adapted to recent commands' : ''}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline font-mono text-[10px] text-slate-500">
            ↑↓ navigate · Enter to {isConnected ? 'send' : 'draft'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-slate-400 hover:text-slate-700"
            aria-label="Close Auto-Suggest tooltip"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
        {suggestions.map((item, idx) => {
          const isHighlighted = idx === highlightedIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={isHighlighted}
              onMouseEnter={() => onHighlight(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item.command);
              }}
              className={`w-full px-3.5 py-2.5 text-left flex items-start justify-between gap-3 transition-colors ${
                isHighlighted ? 'bg-blue-50/70' : 'bg-white hover:bg-slate-50'
              }`}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-semibold text-slate-900 leading-snug">
                  &ldquo;{item.command}&rdquo;
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  <span>{item.contextHint}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono text-[10px] text-slate-500">{item.tools}</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 shrink-0 pt-0.5 whitespace-nowrap">
                {isConnected ? (
                  <>
                    <CornerDownLeft className="w-3 h-3" />
                    Run
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="w-3 h-3" />
                    Draft
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface FloatingTabAutoSuggestProps {
  activeTab: WorkspaceTab;
  isConnected: boolean;
  hasRecentHistory: boolean;
  suggestions: AutoSuggestItem[];
  onExecuteSuggestion: (command: string) => void;
}

/**
 * Discreet bottom-right contextual Auto-Suggest tooltip shown on secondary tabs
 * (Khata & Stock, Approvals, Performance, Insights) so store owners can trigger
 * tab-specific voice commands without losing context. Never auto-opens on arrival.
 */
export const FloatingTabAutoSuggest: React.FC<FloatingTabAutoSuggestProps> = ({
  activeTab,
  isConnected,
  hasRecentHistory,
  suggestions,
  onExecuteSuggestion,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  if (activeTab === 'counter' || suggestions.length === 0) return null;

  return (
    <div ref={containerRef} className="fixed bottom-5 right-5 z-40 flex flex-col items-end">
      {open && (
        <div
          role="dialog"
          aria-label="Context-aware voice command suggestions"
          className="mb-2.5 w-[340px] sm:w-[400px] max-w-[calc(100vw-2.5rem)] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
        >
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                Auto-Suggest · {TAB_LABELS[activeTab]}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {hasRecentHistory
                  ? 'Tailored to this tab & your recent voice history'
                  : 'Context-aware Hinglish & English commands for this view'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 shrink-0"
              aria-label="Close voice suggestions"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {suggestions.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onExecuteSuggestion(item.command);
                  setOpen(false);
                }}
                className="w-full px-4 py-2.5 text-left hover:bg-blue-50/60 transition-colors flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-semibold text-slate-900 leading-snug">
                    &ldquo;{item.command}&rdquo;
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{item.contextHint}</div>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 shrink-0 pt-0.5 whitespace-nowrap">
                  <Mic className="w-3 h-3" />
                  {isConnected ? 'Run' : 'Open'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg shadow-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
      >
        <Command className="w-3.5 h-3.5" />
        <span>Voice Auto-Suggest</span>
        <span className="font-mono text-[11px] text-slate-300 tabular-nums">
          ({Math.min(suggestions.length, 4)})
        </span>
      </button>
    </div>
  );
};
