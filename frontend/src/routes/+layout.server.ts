import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ fetch }) => {
	try {
		const response = await fetch('/api/auth/me');
		if (!response.ok) return { user: null };

		const data = (await response.json()) as { user: { id: string } | null };
		return { user: data.user };
	} catch {
		return { user: null };
	}
};
