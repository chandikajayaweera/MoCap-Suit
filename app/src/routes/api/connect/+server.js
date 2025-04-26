import { json } from '@sveltejs/kit';
import { connectToSerialPort } from '$lib/server/serial.js';

export async function POST({ request }) {
	try {
		const data = await request.json();

		if (!data.port) {
			return json({ success: false, error: 'Port is required' }, { status: 400 });
		}

		await connectToSerialPort({
			port: data.port,
			baudRate: data.baudRate || 115200,
			dtrControl: data.dtrControl !== undefined ? data.dtrControl : false
		});

		return json({ success: true });
	} catch (error) {
		console.error('Error connecting to serial port:', error);
		return json(
			{
				success: false,
				error: error.message || 'Failed to connect to serial port'
			},
			{ status: 500 }
		);
	}
}
