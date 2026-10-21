import React, { useState } from 'react';

export const CalculatorApp: React.FC = () => {
  const [display, setDisplay] = useState('0');
  const [prevVal, setPrevVal] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [resetNext, setResetNext] = useState(false);

  const handleBtn = (val: string | number) => {
    if (typeof val === 'number') {
      setDisplay(prev => (prev === '0' || resetNext) ? String(val) : prev + val);
      setResetNext(false);
    } else if (val === 'C') {
      setDisplay('0');
      setPrevVal(null);
      setOp(null);
      setResetNext(false);
    } else if (val === '=') {
      if (op && prevVal !== null) {
        const cur = parseFloat(display);
        let res = cur;
        if (op === '+') res = prevVal + cur;
        if (op === '-') res = prevVal - cur;
        if (op === '*') res = prevVal * cur;
        if (op === '/') res = cur !== 0 ? prevVal / cur : 0;
        setDisplay(String(Number(res.toFixed(8))));
        setPrevVal(null);
        setOp(null);
        setResetNext(true);
      }
    } else {
      setPrevVal(parseFloat(display));
      setOp(val);
      setResetNext(true);
    }
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] p-5 flex flex-col justify-center font-sans select-none text-white">
      {/* Display */}
      <div className="bg-black/40 border border-white/10 rounded-2xl p-4 mb-4 text-right text-3xl font-mono text-white/90 overflow-x-auto shadow-inner">
        {display}
      </div>

      {/* Button Grid */}
      <div className="grid grid-cols-4 gap-2.5 text-sm font-bold">
        {['C', '/', '*', '-'].map(btn => (
          <button 
            key={btn} 
            onClick={() => handleBtn(btn)} 
            className="rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-[#E95420] p-4 transition-colors shadow"
          >
            {btn}
          </button>
        ))}
        {[7, 8, 9, '+'].map(btn => (
          <button 
            key={btn} 
            onClick={() => handleBtn(btn)} 
            className="rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 text-white p-4 transition-colors shadow"
          >
            {btn}
          </button>
        ))}
        {[4, 5, 6, '='].map(btn => (
          <button 
            key={btn} 
            onClick={() => handleBtn(btn)} 
            className={`rounded-xl p-4 transition-all shadow ${
              btn === '=' 
                ? 'bg-[#E95420] hover:bg-[#d84818] active:scale-95 text-white row-span-2 flex items-center justify-center font-black' 
                : 'bg-white/5 hover:bg-white/10 text-white'
            }`}
          >
            {btn}
          </button>
        ))}
        {[1, 2, 3].map(btn => (
          <button 
            key={btn} 
            onClick={() => handleBtn(btn)} 
            className="rounded-xl bg-white/5 hover:bg-white/10 text-white p-4 transition-colors shadow"
          >
            {btn}
          </button>
        ))}
        <button 
          onClick={() => handleBtn(0)} 
          className="col-span-2 rounded-xl bg-white/5 hover:bg-white/10 text-white p-4 transition-colors shadow"
        >
          0
        </button>
        <button 
          onClick={() => setDisplay(prev => prev.includes('.') ? prev : prev + '.')} 
          className="rounded-xl bg-white/5 hover:bg-white/10 text-white p-4 transition-colors shadow"
        >
          .
        </button>
      </div>
    </div>
  );
};
