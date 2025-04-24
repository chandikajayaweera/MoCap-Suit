import { SerialPort } from 'serialport';
import { startPortMonitoring, stopPortMonitoring } from '$lib/server/serial.js';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	// No need to initialize port monitoring on every request
	// It will be started when a port is actually connected

	const response = await resolve(event);
	return response;
}

/** @type {import('@sveltejs/kit').HandleServerError} */
export function handleError({ error, event }) {
	console.error('Server error:', error);

	// Try to clean up resources on critical errors
	try {
		stopPortMonitoring();
	} catch (e) {
		console.error('Error stopping port monitoring during cleanup:', e);
	}

	return {
		message: 'An unexpected error occurred',
		code: error?.code || 'UNKNOWN'
	};
}

// Clean up resources on server shutdown
if (typeof process !== 'undefined') {
	function cleanup() {
		console.log('Server shutting down, cleaning up resources...');
		try {
			stopPortMonitoring();
		} catch (error) {
			console.error('Error during cleanup:', error);
		}
	}

	// Handle various termination signals
	process.on('SIGINT', () => {
		cleanup();
		process.exit(0);
	});

	process.on('SIGTERM', () => {
		cleanup();
		process.exit(0);
	});
}
