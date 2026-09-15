import { apiRequest } from './client';

export type JsonWebPublicKey = JsonWebKey & { kty: 'EC'; crv: 'P-256'; x: string; y: string };
export type Device = { id: string; userId: string; publicKey: JsonWebPublicKey; createdAt: number };
export type Conversation = {
	id: string;
	peerId: string;
	createdAt?: number;
	lastMessageAt?: number | null;
};
export type EncryptedMessage = {
	id: string;
	senderUserId: string;
	senderDeviceId: string;
	ciphertext: string;
	nonce: string;
	createdAt: number;
	envelope: { ephemeralPublicKey: JsonWebPublicKey; wrappedKey: string; nonce: string };
};

export const chatApi = {
	registerDevice: (deviceId: string, publicKey: JsonWebPublicKey) =>
		apiRequest<{ ok: true }>(`/api/chat/devices/${deviceId}`, {
			method: 'PUT',
			body: JSON.stringify({ publicKey })
		}),
	getDevices: (userId: string) =>
		apiRequest<{ devices: Device[] }>(`/api/chat/users/${userId}/devices`),
	getConversations: () => apiRequest<{ conversations: Conversation[] }>('/api/chat/conversations'),
	createConversation: (userId: string) =>
		apiRequest<{ conversation: Conversation }>('/api/chat/conversations', {
			method: 'POST',
			body: JSON.stringify({ userId })
		}),
	getMessages: (conversationId: string, deviceId: string) =>
		apiRequest<{ messages: EncryptedMessage[] }>(
			`/api/chat/conversations/${conversationId}/messages?deviceId=${deviceId}`
		),
	sendMessage: (conversationId: string, message: object) =>
		apiRequest<{ message: { id: string; createdAt: number } }>(
			`/api/chat/conversations/${conversationId}/messages`,
			{ method: 'POST', body: JSON.stringify(message) }
		)
};
