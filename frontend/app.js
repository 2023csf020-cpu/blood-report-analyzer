const menuButton = document.querySelector(".menu-button");
const navigation = document.querySelector(".site-nav");
const progressBar = document.querySelector("#progress-bar");
const certificateDialog = document.querySelector(".certificate-dialog");
const copyEmailButton = document.querySelector("[data-copy-email]");
const toast = document.querySelector(".toast");

const closeMenu = () => {
  menuButton.setAttribute("aria-expanded", "false");
  navigation.classList.remove("is-open");
  document.body.classList.remove("menu-open");
};

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  navigation.classList.toggle("is-open", !isOpen);
  document.body.classList.toggle("menu-open", !isOpen);
});

navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

window.addEventListener(
  "scroll",
  () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.width = `${total > 0 ? (window.scrollY / total) * 100 : 0}%`;
  },
  { passive: true },
);

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1 },
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

document.querySelectorAll("[data-open-certificate]").forEach((button) => {
  button.addEventListener("click", () => certificateDialog.showModal());
});

document.querySelector("[data-close-certificate]").addEventListener("click", () => certificateDialog.close());
certificateDialog.addEventListener("click", (event) => {
  if (event.target === certificateDialog) certificateDialog.close();
});

copyEmailButton.addEventListener("click", async () => {
  const email = copyEmailButton.dataset.copyEmail;

  try {
    await navigator.clipboard.writeText(email);
    copyEmailButton.textContent = "Copied";
    toast.classList.add("is-visible");
    window.setTimeout(() => {
      copyEmailButton.textContent = "Copy email";
      toast.classList.remove("is-visible");
    }, 2200);
  } catch {
    window.location.href = `mailto:${email}`;
  }
});

document.querySelector("#current-year").textContent = new Date().getFullYear();
