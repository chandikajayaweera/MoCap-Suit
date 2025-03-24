/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	const response = await resolve(event);
	return response;
}

/** @type {import('@sveltejs/kit').HandleServerError} */
export function handleError({ error, event }) {
	console.error('Server error:', error);
	return {
		message: 'An unexpected error occurred',
		code: error?.code || 'UNKNOWN'
	};
}
