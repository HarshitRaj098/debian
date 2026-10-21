import React, { useState, useEffect } from 'react';
import { Play, Save, Check } from 'lucide-react';

interface CodeStudioAppProps {
  initialCode?: string;
  initialFilePath?: string;
}

export const CodeStudioApp: React.FC<CodeStudioAppProps> = ({
  initialCode,
  initialFilePath
}) => {
  const [code, setCode] = useState<string>(
    initialCode || 
`// AETHER OS - Ubuntu Linux Userspace
// Interactive JavaScript & Shell Sandbox

function runSystemDiagnosis() {
  const system = {
    kernel: "Linux 6.6.0-aether-generic",
    environment: "Ubuntu 26.04 Noble",
    processes: ["bash", "gnome-shell", "pty_bridge.py"],
    status: "Healthy"
  };

  console.log("Kernel: " + system.kernel);
  console.log("Environment: " + system.environment);
  console.log("Active Core Processes: " + system.processes.join(", "));
  return system.status;
}

console.log("Diagnosis Result: " + runSystemDiagnosis());`
  );

  const [output, setOutput] = useState<string>('Ready.');
  const [filePath, setFilePath] = useState<string>(initialFilePath || 'script.js');
  const [saved, setSaved] = useState<boolean>(false);

  // Agent D: Load file content if path changes
  useEffect(() => {
    if (initialFilePath) {
      setFilePath(initialFilePath);
      fetch(`/api/fs/read?path=${encodeURIComponent(initialFilePath)}`)
        .then(res => res.json())
        .then(data => {
          if (data.content) setCode(data.content);
        })
        .catch(() => {});
    }
  }, [initialFilePath]);

  const handleRun = () => {
    try {
      const logs: string[] = [];
      const customConsole = {
        log: (...args: unknown[]) => {
          logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
        },
        error: (...args: unknown[]) => {
          logs.push('[ERROR] ' + args.join(' '));
        },
        warn: (...args: unknown[]) => {
          logs.push('[WARN] ' + args.join(' '));
        }
      };
      const runFn = new Function('console', code);
      runFn(customConsole);
      setOutput(logs.length > 0 ? logs.join('\n') : '[Code executed with 0 exit code]');
    } catch (err: any) {
      setOutput(`Error: ${err.message}`);
    }
  };

  const handleSave = async () => {
    try {
      await fetch('/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: code })
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] flex flex-col font-sans select-none overflow-hidden text-xs">
      {/* Top Action Toolbar */}
      <div className="h-10 bg-[#282828] border-b border-white/10 px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-white/70 text-xs px-2 py-0.5 rounded bg-black/30 border border-white/5">
            {filePath}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
          >
            {saved ? <Check size={14} className="text-emerald-400" /> : <Save size={14} />}
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>

          <button
            onClick={handleRun}
            className="flex items-center gap-1.5 px-3.5 py-1 rounded-lg bg-[#E95420] hover:bg-[#d84818] text-white text-xs font-bold transition-all shadow-md active:scale-95"
          >
            <Play size={13} fill="currentColor" />
            <span>Run Code</span>
          </button>
        </div>
      </div>

      {/* Editor & Console Split View */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-[#121212]">
        {/* Source Text Area */}
        <div className="flex-1 flex flex-col min-h-[160px] border-r border-white/10">
          <div className="bg-[#181818] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40 border-b border-white/5">
            Editor
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="flex-1 w-full bg-[#141414] text-white/90 p-4 font-mono text-xs leading-relaxed outline-none resize-none selection:bg-[#E95420]/40"
            spellCheck={false}
          />
        </div>

        {/* Output Console */}
        <div className="w-full md:w-80 flex flex-col bg-[#161616] border-t md:border-t-0 border-white/10 h-44 md:h-auto">
          <div className="bg-[#181818] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40 border-b border-white/5 flex items-center justify-between">
            <span>Terminal Output</span>
            <button onClick={() => setOutput('')} className="hover:text-white transition-colors">Clear</button>
          </div>
          <pre className="flex-1 p-3.5 text-emerald-300 font-mono text-[11px] overflow-auto whitespace-pre-wrap selection:bg-emerald-500/30">
            {output}
          </pre>
        </div>
      </div>
    </div>
  );
};
