import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/browser';

import { apiRequest } from './client';

export type User = { id: string };

export type Passkey = {
	credential_id: string;
	name: string | null;
	device_type: string | null;
	backed_up: number;
	created_at: number;
	last_used_at: number | null;
};

type Ceremony<T> = {
	flowId: string;
	options: T;
};

export const authApi = {
	getSession: () => apiRequest<{ user: User | null }>('/api/auth/me'),

	getLoginOptions: () =>
		apiRequest<Ceremony<PublicKeyCredentialRequestOptionsJSON>>('/api/auth/login/options', {
			method: 'POST'
		}),

	verifyLogin: (flowId: string, response: AuthenticationResponseJSON) =>
		apiRequest<{ verified: true; user: User }>('/api/auth/login/verify', {
			method: 'POST',
			body: JSON.stringify({ flowId, response })
		}),

	getRegistrationOptions: (inviteToken: string) =>
		apiRequest<Ceremony<PublicKeyCredentialCreationOptionsJSON>>('/api/auth/register/options', {
			method: 'POST',
			body: JSON.stringify({ inviteToken })
		}),

	verifyRegistration: (flowId: string, response: RegistrationResponseJSON) =>
		apiRequest<{ verified: true; user: User }>('/api/auth/register/verify', {
			method: 'POST',
			body: JSON.stringify({ flowId, response })
		}),

	getPasskeys: () => apiRequest<{ passkeys: Passkey[] }>('/api/auth/passkeys'),

	getPasskeyOptions: () =>
		apiRequest<Ceremony<PublicKeyCredentialCreationOptionsJSON>>('/api/auth/passkeys/options', {
			method: 'POST'
		}),

	verifyPasskey: (flowId: string, response: RegistrationResponseJSON, name?: string) =>
		apiRequest<{ verified: true }>('/api/auth/passkeys/verify', {
			method: 'POST',
			body: JSON.stringify({ flowId, response, name: name || undefined })
		}),

	renamePasskey: (credentialId: string, name: string) =>
		apiRequest<{ ok: true }>(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, {
			method: 'PATCH',
			body: JSON.stringify({ name })
		}),

	removePasskey: (credentialId: string) =>
		apiRequest<{ ok: true }>(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, {
			method: 'DELETE'
		}),

	logout: () => apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' })
};
