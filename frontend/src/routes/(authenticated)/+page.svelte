<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { startRegistration } from '@simplewebauthn/browser';
	import Button from '$lib/components/Button.svelte';
	import { ApiError } from '$lib/api/client';
	import { authApi, type Passkey } from '$lib/api/auth';
	import { chatApi, type Conversation, type Device } from '$lib/api/chat';
	import { decryptMessage, encryptMessage, getOrCreateDevice } from '$lib/messaging/crypto';

	let { data } = $props();
	let device = $state<Awaited<ReturnType<typeof getOrCreateDevice>> | null>(null);
	let conversations = $state<Conversation[]>([]);
	let active = $state<Conversation | null>(null);
	let messages = $state<Array<{ id: string; text: string; mine: boolean; createdAt: number }>>([]);
	let peerId = $state('');
	let draft = $state('');
	let error = $state('');
	let loading = $state(true);
	let sending = $state(false);
	let passkeys = $state<Passkey[]>([]);
	let passkeyName = $state('');
	let registering = $state(false);
	let loggingOut = $state(false);
	let copiedId = $state(false);

	async function copyUserId() {
		try {
			await navigator.clipboard.writeText(data.user.id);
			copiedId = true;
			setTimeout(() => (copiedId = false), 1500);
		} catch {
			error = 'Could not copy your user ID.';
		}
	}

	function friendlyError(cause: unknown) {
		const code = cause instanceof ApiError ? cause.code : 'request_failed';
		const labels: Record<string, string> = {
			user_not_found: 'No user has that ID.',
			cannot_message_self: 'Choose another user.',
			device_not_found: 'This browser is not registered for messaging.',
			message_conflict: 'That message was already sent.',
			last_passkey: 'You cannot remove your only passkey.'
		};
		return labels[code] ?? 'Something went wrong. Please try again.';
	}

	async function loadConversations() {
		conversations = (await chatApi.getConversations()).conversations;
		if (active) active = conversations.find((item) => item.id === active?.id) ?? null;
	}

	async function openConversation(conversation: Conversation) {
		active = conversation;
		messages = [];
		await loadMessages();
	}

	async function loadMessages() {
		if (!active || !device) return;
		try {
			const encrypted = (await chatApi.getMessages(active.id, device.id)).messages;
			const decrypted = await Promise.all(
				encrypted.map(async (message) => ({
					id: message.id,
					text: await decryptMessage(active!.id, device!, message),
					mine: message.senderUserId === data.user.id,
					createdAt: message.createdAt
				}))
			);
			messages = decrypted;
		} catch (cause) {
			error = friendlyError(cause);
		}
	}

	async function startConversation() {
		const userId = peerId.trim();
		if (!userId) return;
		error = '';
		try {
			const result = await chatApi.createConversation(userId);
			peerId = '';
			await loadConversations();
			await openConversation(result.conversation);
		} catch (cause) {
			error = friendlyError(cause);
		}
	}

	async function send() {
		const text = draft.trim();
		if (!text || !active || !device) return;
		sending = true;
		error = '';
		try {
			const [mine, theirs] = await Promise.all([
				chatApi.getDevices(data.user.id),
				chatApi.getDevices(active.peerId)
			]);
			const recipients = [...mine.devices, ...theirs.devices].filter(
				(item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index
			);
			if (!theirs.devices.length) throw new Error('recipient_not_ready');
			const encrypted = await encryptMessage(active.id, device.id, text, recipients as Device[]);
			await chatApi.sendMessage(active.id, encrypted);
			draft = '';
			await Promise.all([loadMessages(), loadConversations()]);
		} catch (cause) {
			error =
				cause instanceof Error && cause.message === 'recipient_not_ready'
					? 'That user has not enabled messaging on a device yet.'
					: friendlyError(cause);
		} finally {
			sending = false;
		}
	}

	async function addPasskey() {
		registering = true;
		error = '';
		try {
			const ceremony = await authApi.getPasskeyOptions();
			const response = await startRegistration({ optionsJSON: ceremony.options });
			await authApi.verifyPasskey(ceremony.flowId, response, passkeyName.trim());
			passkeyName = '';
			passkeys = (await authApi.getPasskeys()).passkeys;
		} catch (cause) {
			error = friendlyError(cause);
		} finally {
			registering = false;
		}
	}

	async function removePasskey(passkey: Passkey) {
		if (!window.confirm(`Remove “${passkey.name ?? 'Passkey'}”?`)) return;
		try {
			await authApi.removePasskey(passkey.credential_id);
			passkeys = passkeys.filter((item) => item.credential_id !== passkey.credential_id);
		} catch (cause) {
			error = friendlyError(cause);
		}
	}

	async function renamePasskey(passkey: Passkey) {
		const name = window.prompt('Passkey name', passkey.name ?? 'Passkey')?.trim();
		if (!name || name === passkey.name) return;
		error = '';
		try {
			await authApi.renamePasskey(passkey.credential_id, name);
			passkeys = passkeys.map((item) =>
				item.credential_id === passkey.credential_id ? { ...item, name } : item
			);
		} catch (cause) {
			error = friendlyError(cause);
		}
	}

	async function logout() {
		loggingOut = true;
		try {
			await authApi.logout();
			await invalidateAll();
			await goto(resolve('/login'));
		} catch {
			error = 'Could not log out.';
			loggingOut = false;
		}
	}

	onMount(() => {
		let timer: ReturnType<typeof setInterval>;
		void (async () => {
			try {
				device = await getOrCreateDevice();
				await chatApi.registerDevice(device.id, device.publicKey);
				await Promise.all([
					loadConversations(),
					authApi.getPasskeys().then((r) => (passkeys = r.passkeys))
				]);
				timer = setInterval(() => {
					void loadConversations();
					void loadMessages();
				}, 4000);
			} catch (cause) {
				error = friendlyError(cause);
			} finally {
				loading = false;
			}
		})();
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Messages · useful.eeru.net</title></svelte:head>

<main class="flex min-h-dvh w-full flex-col bg-white md:flex-row">
	<aside class="flex w-full flex-col border-b border-neutral-200 md:w-80 md:border-r md:border-b-0">
		<header class="border-b border-neutral-200 p-5">
			<h1 class="font-bold tracking-tight">useful messages</h1>
			<p class="mt-1 text-xs text-emerald-700">End-to-end encrypted</p>
		</header>
		<form
			class="flex gap-2 border-b border-neutral-200 p-3"
			onsubmit={(event) => {
				event.preventDefault();
				void startConversation();
			}}
		>
			<input
				class="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-neutral-900"
				bind:value={peerId}
				placeholder="Paste a user ID"
				aria-label="User ID"
			/>
			<Button class="px-3 py-2" type="submit">New</Button>
		</form>
		<nav class="max-h-48 flex-1 overflow-auto md:max-h-none">
			{#if loading}<p class="p-4 text-sm text-neutral-500">Loading…</p>
			{:else if !conversations.length}<p class="p-4 text-sm text-neutral-500">
					No conversations yet.
				</p>
			{:else}{#each conversations as conversation (conversation.id)}
					<button
						class="w-full border-b border-neutral-100 p-4 text-left hover:bg-neutral-50 {active?.id ===
						conversation.id
							? 'bg-neutral-100'
							: ''}"
						onclick={() => openConversation(conversation)}
					>
						<p class="truncate font-mono text-xs">{conversation.peerId}</p>
					</button>
				{/each}{/if}
		</nav>
		<details class="border-t border-neutral-200 p-4 text-sm">
			<summary class="cursor-pointer font-medium">Account & passkeys</summary>
			<div class="mt-3 flex items-start gap-1 text-neutral-500">
				<p class="min-w-0 font-mono text-[11px] break-all">Your ID: {data.user.id}</p>
				<button
					class="shrink-0 rounded p-1 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-neutral-900"
					onclick={copyUserId}
					aria-label="Copy your user ID"
					title={copiedId ? 'Copied' : 'Copy user ID'}
				>
					{#if copiedId}
						<svg viewBox="0 0 20 20" class="size-3.5" aria-hidden="true"
							><path
								d="m4 10 3.5 3.5L16 5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
					{:else}
						<svg viewBox="0 0 20 20" class="size-3.5" aria-hidden="true"
							><rect
								x="6.5"
								y="6.5"
								width="9"
								height="9"
								rx="1.5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
							/><path
								d="M13.5 6.5v-2a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
							/></svg
						>
					{/if}
				</button>
				<span class="sr-only" aria-live="polite">{copiedId ? 'User ID copied' : ''}</span>
			</div>
			<ul class="my-3 space-y-2">
				{#each passkeys as passkey (passkey.credential_id)}
					<li class="flex items-center justify-between gap-2">
						<span class="min-w-0 flex-1 truncate">{passkey.name ?? 'Passkey'}</span>
						<div class="flex shrink-0 gap-2">
							<button
								class="text-xs text-neutral-600 hover:text-neutral-950"
								onclick={() => renamePasskey(passkey)}>Rename</button
							>
							<button
								class="text-xs text-red-700 disabled:text-neutral-300"
								disabled={passkeys.length === 1}
								onclick={() => removePasskey(passkey)}>Remove</button
							>
						</div>
					</li>
				{/each}
			</ul>
			<div class="flex gap-2">
				<input
					class="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs"
					bind:value={passkeyName}
					placeholder="Passkey name"
				/><Button class="px-2 py-1" onclick={addPasskey} disabled={registering}>Add</Button>
			</div>
			<Button variant="secondary" class="mt-3 w-full" onclick={logout} disabled={loggingOut}
				>Log out</Button
			>
		</details>
	</aside>

	<section class="flex min-h-[32rem] flex-1 flex-col">
		{#if active}
			<header class="border-b border-neutral-200 p-4">
				<p class="font-mono text-xs">{active.peerId}</p>
			</header>
			<div class="flex flex-1 flex-col justify-end gap-3 overflow-auto p-5">
				{#if !messages.length}<p class="self-center text-sm text-neutral-400">
						No messages yet.
					</p>{/if}
				{#each messages as message (message.id)}
					<div
						class="max-w-[80%] rounded-2xl px-4 py-2 text-sm {message.mine
							? 'self-end bg-neutral-900 text-white'
							: 'self-start bg-neutral-100'}"
					>
						<p class="break-words whitespace-pre-wrap">{message.text}</p>
						<time class="mt-1 block text-[10px] opacity-60"
							>{new Date(message.createdAt).toLocaleTimeString([], {
								hour: '2-digit',
								minute: '2-digit'
							})}</time
						>
					</div>
				{/each}
			</div>
			<form
				class="flex gap-3 border-t border-neutral-200 p-4"
				onsubmit={(event) => {
					event.preventDefault();
					void send();
				}}
			>
				<textarea
					class="min-h-11 flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
					bind:value={draft}
					maxlength="32000"
					placeholder="Write a message"
					aria-label="Message"></textarea>
				<button
					type="submit"
					class="inline-flex cursor-pointer items-center justify-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-55"
					disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button
				>
			</form>
		{:else}<div
				class="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-400"
			>
				Select a conversation or start one with a user ID.
			</div>{/if}
		{#if error}<div
				class="flex items-center justify-between gap-4 border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700"
				role="alert"
			>
				<p>{error}</p>
				<button
					class="shrink-0 rounded p-1 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-700"
					onclick={() => (error = '')}
					aria-label="Dismiss error"
					title="Dismiss"
				>
					<svg viewBox="0 0 20 20" class="size-4" aria-hidden="true">
						<path
							d="m5 5 10 10M15 5 5 15"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</div>{/if}
	</section>
</main>
