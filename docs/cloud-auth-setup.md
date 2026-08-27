# Ghost Cloud authentication setup

Ghost Cloud uses Supabase Auth with two permanent-account methods:

- Sign in with Apple; and
- passwordless email using either a six-digit code or a sign-in link.

Local filesystem editing remains account-free. Supabase `auth.users.id` is the
canonical identity for Cloud ownership and sharing regardless of sign-in
method.

## Supabase email code and link

In **Authentication → Email Templates → Magic Link**, keep both the token and
confirmation URL in the template. For example:

```html
<h2>Sign in to Ghost Cloud</h2>
<p>Your one-time code is:</p>
<p style="font-size: 24px; font-weight: 600; letter-spacing: 4px;">
  {{ .Token }}
</p>
<p>Or <a href="{{ .ConfirmationURL }}">open Ghost directly</a>.</p>
<p>If you did not request this email, you can ignore it.</p>
```

A useful subject is `{{ .Token }} is your Ghost sign-in code`. Supabase's
default magic-link-only template does not expose the code even though the API
created one.

In **Authentication → URL Configuration**, retain the deployed web URL and
local test URL, and add:

```text
ghost-md://auth/callback
```

The Mac app can exchange that PKCE callback only when macOS has registered an
installed bundle. In `pnpm tauri dev`, enter the emailed code instead of
clicking the link.

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
disables the Apple button, and leaves email code sign-in available.

## Test matrix

1. Sign in on `web.html` with an email code and reload the page.
2. Sign in to the Mac development app with a fresh code for the same email and
   verify it sees the same Cloud workspace.
3. Use a different email to create the second permanent identity needed for
   sharing tests.
4. In an installed Mac build, follow an email link and confirm it returns to
   Ghost and persists the session in Keychain.
5. After Apple is configured, repeat web and installed-Mac sign-in with Apple,
   sign out, and sign back in without creating another workspace.

## References

- [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase email template variables](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Sign in with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)
