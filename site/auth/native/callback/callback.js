(() => {
  const callback = new URL("ghost-md://auth/callback");
  callback.search = window.location.search;
  callback.hash = window.location.hash;

  const openGhost = document.getElementById("open-ghost");
  const status = document.getElementById("status");
  openGhost.href = callback.href;

  const params = new URLSearchParams(
    window.location.search || window.location.hash.replace(/^#/, "?"),
  );
  const error = params.get("error_description") || params.get("error");
  if (error) {
    status.textContent = "Ghost needs to open to finish reporting the sign-in error.";
  }

  window.setTimeout(() => {
    window.location.assign(callback.href);
    window.setTimeout(() => {
      status.textContent = "If Ghost did not open, use the button below.";
    }, 1200);
  }, 100);
})();
