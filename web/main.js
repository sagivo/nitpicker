(() => {
  const ph = window.posthog;
  const capture = (event, props) => {
    try {
      ph?.capture?.(event, props);
    } catch {
      /* analytics must never break the page */
    }
  };

  const repoUrl = "https://github.com/sagivo/nitpicker";
  for (const id of ["github-link", "github-cta"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute("href", repoUrl);
    el.addEventListener("click", () => {
      capture("github_clicked", { location: id });
    });
  }

  const btn = document.getElementById("copy-install");
  if (!btn) return;
  const text =
    btn.getAttribute("data-copy") ||
    "curl -fsSL https://nitpicker.dev/install | bash";

  btn.addEventListener("click", async () => {
    capture("install_copied");
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = "copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove("copied");
      }, 1500);
    } catch {
      const pre = document.getElementById("install-cmd");
      if (!pre) return;
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
})();
