# Ghost Cloud authentication setup

Ghost Cloud uses Supabase Auth with two permanent-account methods:

- Sign in with Apple; and
- passwordless email magic links.

Local filesystem editing remains account-free. Supabase `auth.users.id` is the
canonical identity for Cloud ownership and sharing regardless of sign-in
method.

## Passwordless email

Supabase's standard magic-link email works without a custom template or custom
SMTP provider. Ghost deliberately does not require an emailed numeric code:
new Free-plan projects using Supabase's default mailer cannot customize auth
email templates.

In **Authentication → URL Configuration**, add these exact development and
native callback URLs to the redirect allow list:

```text
http://localhost:1420/app.html
https://ghosteditor.app/auth/native/callback/
ghost-md://auth/callback
```

Keep `ghost-md://auth/callback` while older builds and the browser fallback are
in use. Add the deployed web app's own `app.html` URL when it is hosted.

The web and Mac clients intentionally use different PKCE callbacks. A browser
request returns to `app.html`, where that browser owns the verifier. A request
from the Mac app returns to the HTTPS native callback. macOS opens the installed
Ghost app through its associated-domain entitlement, and Ghost exchanges the
authorization code using the verifier stored by that app.

If the universal link does not open Ghost, the HTTPS callback page offers an
**Open Ghost** button using the custom `ghost-md` scheme while preserving the
callback parameters. This covers fresh association setup and browser user
preference; it is not a replacement for the universal link.

## Domain association

The production site publishes its Apple App Site Association file at:

```text
https://ghosteditor.app/.well-known/apple-app-site-association
```

It authorizes only `/auth/native/*` for Apple application identifier
`9D4KH55H97.com.ghost.app`. The file must return directly over HTTPS with a
successful status and JSON content type—without a redirect. After deployment,
verify the live response rather than only the repository copy.

The site is served by Vercel from `site/`, and `vercel.json` sets
`Content-Type: application/json` on the association file. Treat both live
checks as a release gate: verify the origin is a direct `200` containing the
expected manifest, then verify
`https://app-site-association.cdn-apple.com/a/v1/ghosteditor.app` contains
that same manifest. The custom-scheme fallback continues to work meanwhile.
(Before 2026-09 the file was served by GitHub Pages as
`application/octet-stream`, which Apple's CDN accepted.)

Ghost's macOS bundle declares `applinks:ghosteditor.app`. Universal-link testing
requires the signed app bundle to be installed and launched at least once.
`pnpm tauri dev` is a loose executable and does not own the domain association.
Apple's association CDN can take time to observe a newly deployed file, so keep
the custom-scheme button available during rollout.

## Sign in with Apple

Enable Apple in **Authentication → Sign In / Providers → Apple** after creating
the corresponding Apple Developer identifiers and private key. Configure the
Supabase callback URL shown on that provider screen in the Apple Services ID,
then enter the Services ID, Team ID, Key ID, and generated secret in Supabase.
Keep the Apple private key and generated client secret out of this repository
and client environment files.

The current web and Tauri clients both use Apple's OAuth flow, so the Services
ID must be the first Apple client ID in Supabase. If a later iOS or macOS client
uses Apple's native Authentication Services, group its App ID with the web
Services ID and add the native ID after it as Supabase documents. Test account
linking explicitly before launch, especially for Apple users who hide their
email.

Apple OAuth client secrets expire every six months. Store the `.p8` signing key
securely and put secret rotation on the production operations checklist; an
expired secret stops new Apple sign-ins.

Until the Apple provider is enabled, Ghost detects that project setting,
disables the Apple button, and leaves email magic-link sign-in available.

## Test matrix

1. Request an email link from local `app.html`, click it in the same browser,
   and confirm the Cloud account survives a reload.
2. Install and launch a signed Ghost build, request a fresh email link from its
   Cloud section, and confirm clicking it opens Ghost and signs in.
3. Open the native callback explicitly in a browser and confirm **Open Ghost**
   uses `ghost-md://auth/callback` with its query and fragment intact.
4. Relaunch Ghost and confirm its session persists from Tauri app data without
   a Keychain prompt.
5. Use a different email to create the second permanent identity needed for
   sharing tests.
6. After Apple is configured, repeat web and installed-Mac sign-in with Apple,
   sign out, and sign back in without creating another workspace.

## References

- [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Sign in with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Apple supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)

## Hosting ghosteditor.app (Vercel)

Vercel serves the whole domain. `pnpm build:web` assembles `dist-web/`:
everything in `site/` as is (the landing page and its images, the native
auth callback at `/auth/native/callback/`, and the Apple association file
at `/.well-known/apple-app-site-association`, served as JSON by a header in
`vercel.json`), plus the browser client at `/app/`, built from the
`app.html` entry with `/app/` as its base. The desktop entry and the
project docs under `docs/` are never deployed. `vercel.json` at the
repository root carries the build settings, so a Vercel project pointed at
this repository needs only:

- Environment variables `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`, the same two values as `.env.local`.
  `VITE_GHOST_WEB_URL` overrides the address baked into share links, which
  defaults to `https://ghosteditor.app/app`.
- The domain `ghosteditor.app` (and `www` if wanted), with DNS pointed at
  Vercel. GitHub Pages is then switched off for the repository; the site
  no longer lives under `docs/`.

Supabase needs the deployed address in Authentication → URL Configuration
→ Redirect URLs: `https://ghosteditor.app/app/` and, for preview
deployments, `https://*.vercel.app/app/`. Magic links and OAuth for the web
client return to the page they started from, and `trailingSlash` in
`vercel.json` keeps that page at `/app/`.

The universal link for Mac sign-in keeps working across the move as long
as the association file is reachable at the same path; Apple's CDN
re-fetches it on its own schedule.

Routes in the browser client are hash-based, so no rewrites are needed:
`/app/#/d/<documentId>` opens one document and `/app/#share=<token>`
redeems a share link.
