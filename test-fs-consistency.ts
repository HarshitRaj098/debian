async function testFsConsistency() {
  console.log('Testing CWD consistency...');
  
  // 1. One-shot command
  const exec = async (cmd: string) => {
    const res = await fetch('http://localhost:3000/api/shell/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const result = await res.json();
    if (!res.ok) {
        throw new Error(result.error || 'Command failed');
    }
    return result;
  };

  const res1 = await exec('pwd');
  console.log('CWD before:', res1.stdout ? res1.stdout.trim() : 'undefined');
  
  await exec('cd /tmp && pwd');
  
  const res2 = await exec('pwd');
  console.log('CWD after (expected persistence?):', res2.stdout ? res2.stdout.trim() : 'undefined');
  
  if (res1.stdout.trim() === res2.stdout.trim()) {
    console.log('CWD persistence FAILED.');
  } else {
    console.log('CWD persistence works.');
  }
}

testFsConsistency();
