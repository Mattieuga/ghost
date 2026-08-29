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
http://localhost:1420/web.html
https://ghosteditor.app/auth/native/callback/
ghost-md://auth/callback
```

Keep `ghost-md://auth/callback` while older builds and the browser fallback are
in use. Add the deployed web app's own `web.html` URL when it is hosted.

The web and Mac clients intentionally use different PKCE callbacks. A browser
request returns to `web.html`, where that browser owns the verifier. A request
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

The current marketing site is published by GitHub Pages. Pages does not offer
repository-controlled response headers, so its live AASA response is a release
gate: run `curl -i` against the URL above and confirm `Content-Type:
application/json`. If Pages serves the extensionless file as a generic binary,
move the static site to hosting that can set this header before relying on
universal links. The custom-scheme fallback continues to work meanwhile.

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

1. Request an email link from local `web.html`, click it in the same browser,
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
