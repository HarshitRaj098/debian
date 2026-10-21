import WebSocket from 'ws';

async function diagnoseTerminal() {
  const ws = new WebSocket('ws://localhost:3000?sessionId=diag-session');
  
  const commands = ['whoami', 'pwd', 'ls -F /home/ubuntu', 'echo $PATH', 'invalidcommand'];
  let currentCmd = 0;

  ws.on('open', () => {
    console.log('--- Terminal Backend Diagnostic ---');
    ws.send(JSON.stringify({ type: 'input', data: commands[currentCmd] + '\n' }));
  });

  ws.on('message', (data) => {
    const output = data.toString();
    console.log(`[STDOUT/ERR]: ${JSON.stringify(output)}`);
    
    if (output.includes('ubuntu@aether-os')) {
      if (currentCmd < commands.length - 1) {
        currentCmd++;
        console.log(`--- Executing: ${commands[currentCmd]} ---`);
        ws.send(JSON.stringify({ type: 'input', data: commands[currentCmd] + '\n' }));
      } else {
        console.log('--- Diagnostic Complete ---');
        process.exit(0);
      }
    }
  });

  ws.on('close', () => process.exit(0));
}

diagnoseTerminal();
