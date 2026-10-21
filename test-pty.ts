import WebSocket from 'ws';

async function testPTYStability() {
  const ws = new WebSocket('ws://localhost:3000?sessionId=test-pty');
  
  ws.on('open', () => {
    console.log('Connected to PTY');
    ws.send(JSON.stringify({ type: 'input', data: 'exit\n' })); // Force exit
  });

  ws.on('message', (data) => {
    console.log('Received:', data.toString());
  });

  ws.on('close', () => {
    console.log('Disconnected');
    process.exit(0);
  });
}

testPTYStability();
