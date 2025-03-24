import { json } from '@sveltejs/kit';
import { listSerialPorts } from '$lib/server/serial.js';

export async function GET() {
	try {
		const ports = await listSerialPorts();
		return json({ success: true, ports });
	} catch (error) {
		console.error('Error listing serial ports:', error);
		return json(
			{
				success: false,
				error: error.message || 'Failed to list serial ports'
			},
			{ status: 500 }
		);
	}
}
