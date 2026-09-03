# ghosteditor.app

Everything served at the domain, deployed by Vercel from `pnpm build:web`:

- `index.html`, `icon.png`, `screenshot.png`: the landing page.
- `auth/native/callback/`: where the Mac app's sign-in link lands before
  the universal link hands it to the app.
- `.well-known/apple-app-site-association`: Apple's proof that the Mac app
  may open `/auth/native/*` links.

The browser client is built into `/app/` by `vite.web.config.ts`; it is not
in this folder. Project documentation lives in `docs/` and is never
deployed.
