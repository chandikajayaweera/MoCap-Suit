// app/src/routes/api/debug/+server.js
import { json } from '@sveltejs/kit';
import { setDebugLogging } from '$lib/server/serial.js';

export async function POST({ request }) {
	try {
		const data = await request.json();

		// Set debug logging mode
		if (data.debug !== undefined) {
			setDebugLogging(!!data.debug);
			return json({ success: true, debug: !!data.debug });
		}

		return json({ success: false, error: 'No debug setting provided' }, { status: 400 });
	} catch (error) {
		console.error('Error setting debug mode:', error);
		return json(
			{
				success: false,
				error: error.message || 'Failed to set debug mode'
			},
			{ status: 500 }
		);
	}
}
