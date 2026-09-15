import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent, url }) => {
	const { user } = await parent();

	if (!user) {
		const returnTo = encodeURIComponent(url.pathname + url.search);
		redirect(303, `/login?returnTo=${returnTo}`);
	}

	return { user };
};
