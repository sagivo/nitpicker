(() => {
  const repoUrl = "https://github.com/sagivo/nitpicker";
  for (const id of ["github-link", "github-cta"]) {
    const el = document.getElementById(id);
    if (el) el.setAttribute("href", repoUrl);
  }

  const btn = document.getElementById("copy-install");
  if (!btn) return;
  const text =
    btn.getAttribute("data-copy") ||
    "curl -fsSL https://nitpicker.dev/install | bash";

  btn.addEventListener("click", async () => {
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
