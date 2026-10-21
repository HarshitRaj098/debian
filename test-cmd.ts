const commands = [
  { cmd: 'echo hello', name: 'echo' },
  { cmd: 'pwd', name: 'pwd' },
  { cmd: 'ls -F /home/ubuntu', name: 'ls' },
  { cmd: 'echo "content" > test.txt', name: 'create file' },
  { cmd: 'cat test.txt', name: 'read file' },
  { cmd: 'invalid_cmd', name: 'invalid command' },
  { cmd: 'exit 1', name: 'exit code 1' },
];

async function runTests() {
  for (const { cmd, name } of commands) {
    console.log(`Running: ${name} (${cmd})`);
    try {
      const res = await fetch('http://localhost:3000/api/shell/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });
      const result = await res.json();
      console.log('Result:', JSON.stringify(result, null, 2));
    } catch (e) {
      console.error(`Failed: ${name}`, e);
    }
  }
}

runTests();
