// Build guard: refuse to deploy without the secrets the app cannot safely
// run without. Runs as part of `npm run build`.
//
// SESSION_SECRET signs every login cookie (lib/session-token.ts). Without it
// the code would fall back to a value printed in the repo, which means anyone
// could forge a superadmin login. lib/session-token.ts also throws at runtime
// in production, but failing the build keeps the old (working) deployment
// live instead of replacing it with one that 500s on every request.

const onVercel = !!process.env.VERCEL;

if (!process.env.SESSION_SECRET) {
  if (onVercel) {
    console.error(
      "verify-env: SESSION_SECRET is not set on Vercel. Failing the build on " +
        "purpose — without it login cookies would be forgeable (or, with the " +
        "runtime guard, every page would 500). Add it under Project Settings → " +
        "Environment Variables (any long random string, e.g. `openssl rand -hex 32`), " +
        "then redeploy. Note: setting it logs everyone out once."
    );
    process.exit(1);
  }
  console.warn(
    "verify-env: SESSION_SECRET is not set — fine for local dev, fatal on Vercel."
  );
} else {
  console.log("verify-env: SESSION_SECRET is set ✓");
}
