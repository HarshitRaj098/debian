import WebSocket from 'ws';

async function testInitialCommand() {
  const ws = new WebSocket('ws://localhost:3000?sessionId=test-init-cmd');
  
  ws.on('open', () => {
    console.log('Connected, sending initial command');
    // Using \n for bash command termination
    ws.send(JSON.stringify({ type: 'input', data: 'echo "hello from initial command"\n' }));
  });

  ws.on('message', (data) => {
    const output = data.toString();
    console.log('Received:', JSON.stringify(output));
    if (output.includes('hello from initial command')) {
      console.log('--- Success ---');
      process.exit(0);
    }
  });
}

testInitialCommand();
