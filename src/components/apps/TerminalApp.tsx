import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { 
  ClipboardPaste, 
  Copy, 
  Trash2, 
  Terminal as TerminalIcon, 
  Check, 
  CornerDownLeft, 
  X,
  Keyboard
} from 'lucide-react';

// Safe default cell dimensions
const SAFE_DIMENSIONS = {
  css: {
    canvas: { width: 0, height: 0 },
    cell: { width: 9, height: 17 }
  },
  device: {
    canvas: { width: 0, height: 0 },
    cell: { width: 9, height: 17 },
    char: { width: 9, height: 17, left: 0, top: 0 }
  }
};

// Globally patch FitAddon.prototype.proposeDimensions to prevent reading dimensions of undefined renderer
if (typeof window !== 'undefined' && FitAddon && FitAddon.prototype) {
  FitAddon.prototype.proposeDimensions = function () {
    try {
      const self = this as any;
      if (!self._terminal) return undefined;
      const el = self._terminal.element;
      if (!el || !el.parentElement) return undefined;

      const core = self._terminal._core;
      if (!core) return undefined;

      const rs = core._renderService;
      if (!rs) return undefined;

      // Ensure dimensions is accessible without throwing
      const dims = rs._renderer?.value?.dimensions || rs.dimensions || SAFE_DIMENSIONS;
      if (!dims || !dims.css || !dims.css.cell || dims.css.cell.width <= 0 || dims.css.cell.height <= 0) {
        return undefined;
      }

      const scrollBarWidth = 0 === self._terminal.options.scrollback ? 0 : (core.viewport?.scrollBarWidth || 0);
      const parentStyle = window.getComputedStyle(el.parentElement);
      const parentHeight = parseInt(parentStyle.getPropertyValue('height'), 10) || 0;
      const parentWidth = Math.max(0, parseInt(parentStyle.getPropertyValue('width'), 10) || 0);

      const termStyle = window.getComputedStyle(el);
      const padTop = parseInt(termStyle.getPropertyValue('padding-top'), 10) || 0;
      const padBottom = parseInt(termStyle.getPropertyValue('padding-bottom'), 10) || 0;
      const padRight = parseInt(termStyle.getPropertyValue('padding-right'), 10) || 0;
      const padLeft = parseInt(termStyle.getPropertyValue('padding-left'), 10) || 0;

      const availHeight = parentHeight - (padTop + padBottom);
      const availWidth = parentWidth - (padRight + padLeft) - scrollBarWidth;

      if (availWidth <= 10 || availHeight <= 10) return undefined;

      const cols = Math.max(2, Math.floor(availWidth / dims.css.cell.width));
      const rows = Math.max(1, Math.floor(availHeight / dims.css.cell.height));

      return { cols, rows };
    } catch {
      return undefined;
    }
  };
}

// Guard xterm RenderService prototype to prevent uncaught dimensions error during lifecycle/unmount
const patchRenderService = (term: Terminal) => {
  try {
    const rs = (term as any)?._core?._renderService;
    if (!rs) return;
    const proto = Object.getPrototypeOf(rs);
    if (proto && !proto.__dimensionsSafeGuarded) {
      proto.__dimensionsSafeGuarded = true;
      Object.defineProperty(proto, 'dimensions', {
        get() {
          return this._renderer?.value?.dimensions || SAFE_DIMENSIONS;
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch {
    // Non-critical environment guard
  }
};

import { eventBridge } from '../../adapters/discoveryEngine';

interface TerminalAppProps {
  initialData?: {
    command?: string;
  };
}

export const TerminalApp: React.FC<TerminalAppProps> = ({ initialData }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // UI state for clipboard feedback & context menu
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [pastedFeedback, setPastedFeedback] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');
  const manualPasteInputRef = useRef<HTMLTextAreaElement>(null);

  const sendInput = (text: string) => {
    if (!text) return;
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'input', data: text }));
      setPastedFeedback(true);
      setTimeout(() => setPastedFeedback(false), 1500);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          sendInput(text);
          return;
        }
      }
      // If clipboard is empty or permission denied, open paste prompt
      setShowPasteModal(true);
    } catch {
      // Browser iframe permission blocked -> open smooth paste modal
      setShowPasteModal(true);
    }
  };

  const copySelectionToClipboard = async () => {
    if (!termInstance.current) return;
    const selection = termInstance.current.getSelection();
    if (selection) {
      try {
        await navigator.clipboard.writeText(selection);
        setCopiedFeedback(true);
        setTimeout(() => setCopiedFeedback(false), 1500);
      } catch {
        // Fallback
      }
    }
  };

  const clearTerminal = () => {
    if (termInstance.current) {
      termInstance.current.clear();
      sendInput('\x0c'); // Send FormFeed / Ctrl+L to redraw prompt
    }
  };

  useEffect(() => {
    if (showPasteModal) {
      setTimeout(() => {
        manualPasteInputRef.current?.focus();
      }, 50);
    }
  }, [showPasteModal]);

  useEffect(() => {
    if (!terminalRef.current) return;

    let isDisposed = false;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#300a24', // Authentic Ubuntu terminal aubergine
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#300a24',
        selectionBackground: 'rgba(233, 84, 32, 0.45)', // Ubuntu orange selection
        black: '#2e3436',
        red: '#cc0000',
        green: '#4e9a06',
        yellow: '#c4a000',
        blue: '#3465a4',
        magenta: '#75507b',
        cyan: '#06989a',
        white: '#d3d7cf',
        brightBlack: '#555753',
        brightRed: '#ef2929',
        brightGreen: '#8ae234',
        brightYellow: '#fce94f',
        brightBlue: '#729fcf',
        brightMagenta: '#ad7fa8',
        brightCyan: '#34e2e2',
        brightWhite: '#eeeeec'
      },
      fontSize: 13,
      fontFamily: 'Ubuntu Mono, Cascadia Code, Menlo, monospace',
      letterSpacing: 0,
      lineHeight: 1.15
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    // Apply prototype dimensions safety guard immediately
    patchRenderService(term);

    // Enable Ctrl+V and Ctrl+C keyboard handling
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Check for Ctrl+V / Cmd+V or Ctrl+Shift+V
      const isPaste = (e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V');
      if (isPaste) {
        if (e.type === 'keydown') {
          if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText()
              .then((text) => {
                if (text) {
                  sendInput(text);
                }
              })
              .catch(() => {
                // If browser denies permission, open prompt
                setShowPasteModal(true);
              });
          } else {
            setShowPasteModal(true);
          }
        }
        return false; // Prevent xterm from sending raw \x16 character to bash
      }

      // Check for Ctrl+C / Cmd+C
      const isCopy = (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C');
      if (isCopy) {
        if (term.hasSelection()) {
          if (e.type === 'keydown') {
            const selected = term.getSelection();
            if (selected && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(selected)
                .then(() => {
                  setCopiedFeedback(true);
                  setTimeout(() => setCopiedFeedback(false), 1500);
                })
                .catch(() => {});
            }
          }
          return false; // Do not send SIGINT when copying selected text
        }
        // If nothing is selected, send normal SIGINT (^C) to bash
        return true;
      }

      return true;
    });

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/terminal?sessionId=ubuntu-default`);
    socketRef.current = socket;

    const safeFit = () => {
      if (isDisposed) return;
      if (!terminalRef.current) return;
      const { clientWidth, clientHeight } = terminalRef.current;
      if (clientWidth <= 10 || clientHeight <= 10) return;

      try {
        fitAddon.fit();
        if (socket.readyState === WebSocket.OPEN && term.cols && term.rows) {
          socket.send(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows
          }));
        }
      } catch {
        // Layout dimension race safely caught
      }
    };

    // Wait until browser layout and font metrics are resolved before initial fit
    const timer = setTimeout(safeFit, 100);

    socket.onopen = () => {
      safeFit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'resize',
          cols: term.cols || 80,
          rows: term.rows || 24
        }));

        // Execute initial command if provided
        if (initialData?.command) {
          // Send command + Enter with a delay to ensure bash prompt is ready
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'input', data: initialData.command + '\n' }));
            }
          }, 500);
        }
      }
    };

    socket.onmessage = (event) => {
      if (!isDisposed) {
        term.write(event.data);
      }
    };

    socket.onerror = () => {
      if (!isDisposed) {
        term.writeln('\r\n\x1b[31m[WebSocket connection error - Terminal gateway unavailable]\x1b[0m\r\n');
      }
    };

    socket.onclose = () => {
      if (!isDisposed) {
        term.writeln('\r\n\x1b[33m[Session disconnected]\x1b[0m\r\n');
      }
    };

    term.onData((data) => {
      if (!isDisposed && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
        
        // Agent C: Emit FS change on Enter key for live sync
        if (data.includes('\r') || data.includes('\n')) {
          setTimeout(() => eventBridge.emit('fs.changed', {}), 300);
        }
      }
    });

    // Native DOM paste listener on the terminal container
    const handleDomPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text');
      if (text) {
        e.preventDefault();
        sendInput(text);
      }
    };

    const containerEl = terminalRef.current;
    if (containerEl) {
      containerEl.addEventListener('paste', handleDomPaste);
    }

    const handleResize = () => {
      safeFit();
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 10 && entry.contentRect.height > 10) {
          safeFit();
        }
      }
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      isDisposed = true;
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      if (containerEl) {
        containerEl.removeEventListener('paste', handleDomPaste);
      }
      resizeObserver.disconnect();
      try {
        socket.close();
      } catch {}
      try {
        fitAddon.dispose();
      } catch {}
      try {
        term.dispose();
      } catch {}
    };
  }, []);

  const lastExecutedCommandRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialData?.command && initialData.command !== lastExecutedCommandRef.current) {
      lastExecutedCommandRef.current = initialData.command;
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'input', data: initialData.command + '\n' }));
      }
    }
  }, [initialData]);

  const handleManualPasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPasteText) {
      sendInput(manualPasteText);
      setManualPasteText('');
      setShowPasteModal(false);
      termInstance.current?.focus();
    }
  };

  return (
    <div 
      className="w-full h-full bg-[#300a24] flex flex-col font-mono relative overflow-hidden select-text"
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onClick={() => setContextMenu(null)}
    >
      {/* Ubuntu Terminal Quick Toolbar */}
      <div className="h-7 bg-[#24061a] border-b border-white/10 px-2.5 flex items-center justify-between text-xs text-white/70 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <TerminalIcon size={12} className="text-emerald-400" />
          <span className="text-[11px] font-semibold text-white/80">bash · aether@noble:~</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Quick Paste Button */}
          <button
            onClick={pasteFromClipboard}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
              pastedFeedback 
                ? 'bg-emerald-600 text-white' 
                : 'hover:bg-white/10 text-white/80 hover:text-white'
            }`}
            title="Paste Linux command (Ctrl+V)"
          >
            {pastedFeedback ? <Check size={12} /> : <ClipboardPaste size={12} />}
            <span>{pastedFeedback ? 'Pasted!' : 'Paste'}</span>
            <span className="text-[9px] bg-white/10 px-1 rounded font-mono text-white/60">Ctrl+V</span>
          </button>

          {/* Quick Copy Button */}
          <button
            onClick={copySelectionToClipboard}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
              copiedFeedback 
                ? 'bg-emerald-600 text-white' 
                : 'hover:bg-white/10 text-white/80 hover:text-white'
            }`}
            title="Copy selected text (Ctrl+C)"
          >
            {copiedFeedback ? <Check size={12} /> : <Copy size={12} />}
            <span>{copiedFeedback ? 'Copied!' : 'Copy'}</span>
            <span className="text-[9px] bg-white/10 px-1 rounded font-mono text-white/60">Ctrl+C</span>
          </button>

          {/* Quick Clear Button */}
          <button
            onClick={clearTerminal}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="Clear terminal (Ctrl+L)"
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div className="flex-1 w-full h-full overflow-hidden p-1.5" ref={terminalRef} />

      {/* Right-Click Terminal Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e1e]/98 backdrop-blur-xl border border-white/15 rounded-xl py-1 shadow-2xl text-xs text-white min-w-44 select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setContextMenu(null);
              pasteFromClipboard();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#E95420] hover:text-white transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <ClipboardPaste size={14} />
              <span>Paste</span>
            </div>
            <span className="text-[10px] text-white/50 font-mono">Ctrl+V</span>
          </button>

          <button
            onClick={() => {
              setContextMenu(null);
              copySelectionToClipboard();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#E95420] hover:text-white transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Copy size={14} />
              <span>Copy</span>
            </div>
            <span className="text-[10px] text-white/50 font-mono">Ctrl+C</span>
          </button>

          <div className="h-px bg-white/10 my-1" />

          <button
            onClick={() => {
              setContextMenu(null);
              termInstance.current?.selectAll();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-white/80 hover:text-white transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Keyboard size={14} />
              <span>Select All</span>
            </div>
            <span className="text-[10px] text-white/50 font-mono">Ctrl+A</span>
          </button>

          <button
            onClick={() => {
              setContextMenu(null);
              clearTerminal();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-white/80 hover:text-white transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Trash2 size={14} />
              <span>Clear Terminal</span>
            </div>
            <span className="text-[10px] text-white/50 font-mono">Ctrl+L</span>
          </button>
        </div>
      )}

      {/* Manual Paste Modal Dialog (Guaranteed fallback for restricted browser iframes) */}
      {showPasteModal && (
        <div 
          className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-100"
          onClick={() => setShowPasteModal(false)}
        >
          <div 
            className="bg-[#24061a] border border-[#E95420]/40 rounded-2xl p-4 w-full max-w-md shadow-2xl text-white select-none animate-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ClipboardPaste size={16} className="text-[#E95420]" />
                <span className="text-xs font-bold">Paste Command into Linux Terminal</span>
              </div>
              <button
                onClick={() => setShowPasteModal(false)}
                className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[11px] text-white/60 mb-3">
              Press <kbd className="px-1 py-0.5 rounded bg-white/10 text-white font-mono text-[10px]">Ctrl+V</kbd> below to paste your commands, then press Enter or click Send:
            </p>
            <form onSubmit={handleManualPasteSubmit}>
              <textarea
                ref={manualPasteInputRef}
                value={manualPasteText}
                onChange={(e) => setManualPasteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleManualPasteSubmit(e);
                  }
                }}
                rows={4}
                placeholder="Paste command here (e.g. ls -la, git status, echo 'hello')..."
                className="w-full bg-black/40 border border-white/20 focus:border-[#E95420] rounded-xl p-3 text-xs font-mono text-emerald-400 placeholder-white/30 outline-none resize-none mb-3"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPasteModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!manualPasteText.trim()}
                  className="px-4 py-1.5 rounded-lg bg-[#E95420] hover:bg-[#d84818] disabled:opacity-40 disabled:hover:bg-[#E95420] text-xs font-bold text-white transition-colors flex items-center gap-1.5 shadow"
                >
                  <span>Send to Terminal</span>
                  <CornerDownLeft size={13} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
