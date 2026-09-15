export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string
	) {
		super(code);
		this.name = 'ApiError';
	}
}

type ErrorResponse = { error?: string };

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

	let response: Response;
	try {
		response = await fetch(path, { ...init, headers, credentials: 'include' });
	} catch {
		throw new ApiError(0, 'network_error');
	}

	const data = (await response.json().catch(() => ({}))) as T & ErrorResponse;
	if (!response.ok) throw new ApiError(response.status, data.error ?? 'request_failed');
	return data;
}
