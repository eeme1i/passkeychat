import { describe, expect, it } from 'vitest';

import type { Device, JsonWebPublicKey } from '$lib/api/chat';
import { decryptMessage, encryptMessage } from './crypto';

describe('message encryption', () => {
	it('round-trips for the intended device and authenticates conversation metadata', async () => {
		const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
			'deriveBits'
		])) as CryptoKeyPair;
		const device = {
			id: crypto.randomUUID(),
			privateKey: keys.privateKey,
			publicKey: (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebPublicKey
		};
		const recipient: Device = { ...device, userId: crypto.randomUUID(), createdAt: Date.now() };
		const conversationId = crypto.randomUUID();
		const encrypted = await encryptMessage(
			conversationId,
			device.id,
			'only the browser sees this',
			[recipient]
		);
		const serverMessage = {
			...encrypted,
			senderUserId: recipient.userId,
			createdAt: Date.now(),
			envelope: encrypted.envelopes[0]
		};

		expect(await decryptMessage(conversationId, device, serverMessage)).toBe(
			'only the browser sees this'
		);
		await expect(decryptMessage(crypto.randomUUID(), device, serverMessage)).rejects.toThrow();
	});
});
