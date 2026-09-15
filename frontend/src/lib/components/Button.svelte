<script lang="ts" module>
	export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
</script>

<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	type Props = Omit<HTMLButtonAttributes, 'children'> & {
		children: Snippet;
		variant?: ButtonVariant;
		fullWidth?: boolean;
	};

	let {
		children,
		variant = 'primary',
		fullWidth = false,
		type = 'button',
		class: className,
		...rest
	}: Props = $props();

	const variants: Record<ButtonVariant, string> = {
		primary: 'bg-neutral-950 text-white hover:bg-neutral-800',
		secondary: 'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100',
		ghost: 'bg-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950'
	};
</script>

<button
	{type}
	class={[
		'inline-flex cursor-pointer items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-55',
		variants[variant],
		fullWidth && 'w-full',
		className
	]}
	{...rest}
>
	{@render children()}
</button>
