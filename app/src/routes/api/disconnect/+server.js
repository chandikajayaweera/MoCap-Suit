import { json } from '@sveltejs/kit';
import { disconnectFromSerialPort } from '$lib/server/serial.js';

export async function POST() {
	try {
		await disconnectFromSerialPort();
		return json({ success: true });
	} catch (error) {
		console.error('Error disconnecting from serial port:', error);
		return json(
			{
				success: false,
				error: error.message || 'Failed to disconnect from serial port'
			},
			{ status: 500 }
		);
	}
}
