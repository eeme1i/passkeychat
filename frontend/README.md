# useful frontend

## Configuration

Copy `.env.example` to `.env` when you need to override local defaults:

```sh
cp .env.example .env
```

`API_PROXY_TARGET` is the backend origin used by Vite's development server for
requests under `/api`. It defaults to `http://localhost:8787`.

Production must route `/api` to the backend at the hosting or reverse-proxy
layer. Vite's `server.proxy` setting is not included in the production build.

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
pnpm dlx sv@0.17.0 create --template minimal --types ts --add eslint vitest="usages:unit,component" tailwindcss="plugins:none" prettier --install pnpm frontend
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
