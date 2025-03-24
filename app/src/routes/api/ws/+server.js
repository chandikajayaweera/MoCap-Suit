import { error } from '@sveltejs/kit';

/**
 * WebSocket connection handler
 */
export function GET(event) {
	const { platform } = event;

	// Check if websocket is supported by the adapter
	if (!platform?.websocket) {
		throw error(400, 'WebSocket not supported by adapter');
	}

	// Accept the WebSocket connection using SvelteKit's API
	const { websocket } = platform;
	websocket.accept();

	// Store client in global registry for broadcasts
	global.activeWebSocketClients = global.activeWebSocketClients || new Set();
	global.activeWebSocketClients.add(websocket);

	// Send welcome message
	websocket.send(
		JSON.stringify({
			type: 'log',
			message: '[SERVER] WebSocket connection established'
		})
	);

	// Handle messages
	websocket.addEventListener('message', (event) => {
		try {
			const data = JSON.parse(event.data);
			console.log('WebSocket received message:', data);

			if (data.type === 'command' && data.command) {
				// Handle command
				if (global.serialPort && global.serialPort.isOpen) {
					global.serialPort.write(data.command + '\n');
					console.log(`Command sent to serial port: ${data.command}`);

					// Send confirmation to client
					websocket.send(
						JSON.stringify({
							type: 'log',
							message: `[INFO] Command sent: ${data.command}`
						})
					);
				} else {
					websocket.send(
						JSON.stringify({
							type: 'log',
							message: '[ERROR] Serial port not connected'
						})
					);
				}
			}
		} catch (error) {
			console.error('Error processing WebSocket message:', error);

			try {
				websocket.send(
					JSON.stringify({
						type: 'log',
						message: `[ERROR] Failed to process message: ${error.message}`
					})
				);
			} catch (e) {
				console.error('Failed to send error message back to client:', e);
			}
		}
	});

	// Clean up on close
	websocket.addEventListener('close', () => {
		console.log('WebSocket connection closed');
		if (global.activeWebSocketClients) {
			global.activeWebSocketClients.delete(websocket);
		}
	});

	// Keep the connection open
	return new Response(undefined, { status: 101 });
}
