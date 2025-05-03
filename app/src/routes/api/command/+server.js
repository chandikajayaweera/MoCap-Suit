import { json } from '@sveltejs/kit';
import { sendCommand } from '$lib/server/serial.js';

export async function POST({ request }) {
	try {
		const data = await request.json();

		if (!data.command) {
			return json({ success: false, error: 'Command is required' }, { status: 400 });
		}

		const result = sendCommand(data.command);
		return json({ success: result });
	} catch (error) {
		console.error('Error sending command:', error);
		return json(
			{
				success: false,
				error: error.message || 'Failed to send command'
			},
			{ status: 500 }
		);
	}
}
