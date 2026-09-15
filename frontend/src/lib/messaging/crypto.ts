import type { Device, EncryptedMessage, JsonWebPublicKey } from '$lib/api/chat';

type LocalDevice = { id: string; privateKey: CryptoKey; publicKey: JsonWebPublicKey };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes: ArrayBuffer | Uint8Array) {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = '';
	for (const byte of view) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function bytes(value: string) {
	const padded =
		value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4);
	return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function openDatabase() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open('useful-messaging', 1);
		request.onupgradeneeded = () => request.result.createObjectStore('keys');
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function storedDevice(): Promise<LocalDevice | undefined> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const request = db.transaction('keys').objectStore('keys').get('device');
		request.onsuccess = () => resolve(request.result as LocalDevice | undefined);
		request.onerror = () => reject(request.error);
	});
}

async function saveDevice(device: LocalDevice) {
	const db = await openDatabase();
	return new Promise<void>((resolve, reject) => {
		const transaction = db.transaction('keys', 'readwrite');
		transaction.objectStore('keys').put(device, 'device');
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
}

export async function getOrCreateDevice(): Promise<LocalDevice> {
	const stored = await storedDevice();
	if (stored) return stored;
	const generated = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits'
	])) as CryptoKeyPair;
	const publicKey = (await crypto.subtle.exportKey('jwk', generated.publicKey)) as JsonWebPublicKey;
	const privateBytes = await crypto.subtle.exportKey('pkcs8', generated.privateKey);
	const privateKey = await crypto.subtle.importKey(
		'pkcs8',
		privateBytes,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits']
	);
	const device = { id: crypto.randomUUID(), privateKey, publicKey };
	await saveDevice(device);
	return device;
}

async function wrappingKey(
	privateKey: CryptoKey,
	publicJwk: JsonWebPublicKey,
	messageId: string,
	deviceId: string
) {
	const publicKey = await crypto.subtle.importKey(
		'jwk',
		publicJwk,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const secret = await crypto.subtle.deriveBits(
		{ name: 'ECDH', public: publicKey },
		privateKey,
		256
	);
	const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: encoder.encode(messageId),
			info: encoder.encode(`useful-wrap-v1:${deviceId}`)
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function encryptMessage(
	conversationId: string,
	senderDeviceId: string,
	plaintext: string,
	recipients: Device[]
) {
	const messageId = crypto.randomUUID();
	const messageKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
		'encrypt'
	]);
	const rawMessageKey = await crypto.subtle.exportKey('raw', messageKey);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: nonce,
			additionalData: encoder.encode(`useful-message-v1:${conversationId}:${messageId}`)
		},
		messageKey,
		encoder.encode(plaintext)
	);
	const envelopes = await Promise.all(
		recipients.map(async (device) => {
			const ephemeral = (await crypto.subtle.generateKey(
				{ name: 'ECDH', namedCurve: 'P-256' },
				true,
				['deriveBits']
			)) as CryptoKeyPair;
			const key = await wrappingKey(ephemeral.privateKey, device.publicKey, messageId, device.id);
			const wrapNonce = crypto.getRandomValues(new Uint8Array(12));
			const wrapped = await crypto.subtle.encrypt(
				{
					name: 'AES-GCM',
					iv: wrapNonce,
					additionalData: encoder.encode(`useful-envelope-v1:${messageId}:${device.id}`)
				},
				key,
				rawMessageKey
			);
			return {
				deviceId: device.id,
			ephemeralPublicKey: (await crypto.subtle.exportKey(
				'jwk',
				ephemeral.publicKey
			)) as JsonWebPublicKey,
				wrappedKey: base64url(wrapped),
				nonce: base64url(wrapNonce)
			};
		})
	);
	return {
		id: messageId,
		senderDeviceId,
		ciphertext: base64url(ciphertext),
		nonce: base64url(nonce),
		envelopes
	};
}

export async function decryptMessage(
	conversationId: string,
	device: LocalDevice,
	message: EncryptedMessage
) {
	const wrapKey = await wrappingKey(
		device.privateKey,
		message.envelope.ephemeralPublicKey,
		message.id,
		device.id
	);
	const rawMessageKey = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: bytes(message.envelope.nonce),
			additionalData: encoder.encode(`useful-envelope-v1:${message.id}:${device.id}`)
		},
		wrapKey,
		bytes(message.envelope.wrappedKey)
	);
	const messageKey = await crypto.subtle.importKey('raw', rawMessageKey, 'AES-GCM', false, [
		'decrypt'
	]);
	const plaintext = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: bytes(message.nonce),
			additionalData: encoder.encode(`useful-message-v1:${conversationId}:${message.id}`)
		},
		messageKey,
		bytes(message.ciphertext)
	);
	return decoder.decode(plaintext);
}
