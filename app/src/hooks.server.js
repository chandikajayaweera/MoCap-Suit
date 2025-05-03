import { stopPortMonitoring } from '$lib/server/serial.js';

export async function handle({ event, resolve }) {
	const response = await resolve(event);
	return response;
}

export function handleError({ error }) {
	console.error('Server error:', error);

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

if (typeof process !== 'undefined') {
	function cleanup() {
		console.log('Server shutting down, cleaning up resources...');
		try {
			stopPortMonitoring();
		} catch (error) {
			console.error('Error during cleanup:', error);
		}
	}

	process.on('SIGINT', () => {
		cleanup();
		process.exit(0);
	});

	process.on('SIGTERM', () => {
		cleanup();
		process.exit(0);
	});
}
