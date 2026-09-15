<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		browserSupportsWebAuthn,
		startAuthentication,
		startRegistration
	} from '@simplewebauthn/browser';
	import Button from '$lib/components/Button.svelte';
	import { ApiError } from '$lib/api/client';
	import { authApi } from '$lib/api/auth';

	let inviteToken = $state('');
	let registering = $state(false);
	let busy = $state(false);
	let error = $state('');
	let supportsPasskeys = $state(true);

	function destination() {
		const returnTo = page.url.searchParams.get('returnTo');
		return returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
	}

	function friendlyError(cause: unknown) {
		if (cause instanceof DOMException && cause.name === 'NotAllowedError')
			return 'The passkey prompt was cancelled or timed out. Please try again.';
		const code = cause instanceof ApiError ? cause.code : 'request_failed';
		const messages: Record<string, string> = {
			invalid_invite: 'That invite is invalid, expired, or has already been used.',
			invite_required: 'Enter an invite token to create an account.',
			registration_expired: 'Registration expired. Please try again.',
			registration_conflict: 'That invite has already been used.',
			registration_verification_failed: 'The passkey could not be verified. Please try again.',
			authentication_expired: 'Login expired. Please try again.',
			authentication_failed: 'The passkey could not be verified.',
			unknown_passkey: 'That passkey is not registered with this application.',
			network_error: 'The server could not be reached. Check your connection and try again.'
		};
		return messages[code] ?? 'Something went wrong. Please try again.';
	}

	async function run(action: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await action();
		} catch (cause) {
			error = friendlyError(cause);
		} finally {
			busy = false;
		}
	}

	async function finishAuthentication() {
		await invalidateAll();
		// returnTo is runtime route data and is restricted to same-origin absolute paths above.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(destination());
	}

	async function login() {
		await run(async () => {
			const ceremony = await authApi.getLoginOptions();
			const response = await startAuthentication({ optionsJSON: ceremony.options });
			await authApi.verifyLogin(ceremony.flowId, response);
			await finishAuthentication();
		});
	}

	async function register(event: SubmitEvent) {
		event.preventDefault();
		const token = inviteToken.trim();
		if (!token) {
			error = 'Enter an invite token to create an account.';
			return;
		}

		await run(async () => {
			const ceremony = await authApi.getRegistrationOptions(token);
			const response = await startRegistration({ optionsJSON: ceremony.options });
			await authApi.verifyRegistration(ceremony.flowId, response);
			await finishAuthentication();
		});
	}

	onMount(() => {
		supportsPasskeys = browserSupportsWebAuthn();
	});
</script>

<svelte:head><title>Log in · useful.eeru.net</title></svelte:head>

<main class="flex flex-1 flex-col items-center justify-center px-6">
	<section class="flex w-full max-w-sm flex-col items-center gap-6 text-center">
		<div class="space-y-1">
			<h1 class="text-xl font-bold tracking-tight">useful.eeru.net</h1>
			<p class="text-sm text-neutral-500">A private, passwordless application.</p>
		</div>
		{#if !supportsPasskeys}
			<p class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
				This browser does not support passkeys. Try a recent version of Safari, Chrome, Edge, or
				Firefox.
			</p>
		{:else}
			<div class="flex w-full flex-col gap-3">
				<Button fullWidth onclick={login} disabled={busy}
					>{busy && !registering ? 'Waiting for passkey…' : 'Log in with a passkey'}</Button
				>
				{#if registering}
					<form
						class="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4 text-left"
						onsubmit={register}
					>
						<label for="invite" class="text-sm font-medium">Invite token</label>
						<input
							id="invite"
							class="rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
							type="text"
							bind:value={inviteToken}
							autocomplete="off"
							spellcheck="false"
							disabled={busy}
							placeholder="Paste your invite token"
						/>
						<Button fullWidth type="submit" disabled={busy}
							>{busy ? 'Creating passkey…' : 'Create account'}</Button
						>
						<Button variant="ghost" onclick={() => (registering = false)} disabled={busy}
							>Cancel</Button
						>
					</form>
				{:else}
					<Button
						variant="ghost"
						onclick={() => {
							registering = true;
							error = '';
						}}
						disabled={busy}>Have an invite? Create an account</Button
					>
				{/if}
			</div>
		{/if}
		{#if error}<p class="text-sm text-red-700" role="alert">{error}</p>{/if}
	</section>
</main>
