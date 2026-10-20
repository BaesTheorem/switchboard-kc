// Light, dark, or the device's setting (Settings > Appearance).

const media = matchMedia("(prefers-color-scheme: dark)");
let mode = "auto";

function paint() {
  const dark = mode === "dark" || (mode === "auto" && media.matches);
  document.body.classList.toggle("dark", dark);
  document.body.classList.toggle("light", !dark);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = dark ? "#121217" : "#fafaff";
  document.dispatchEvent(new CustomEvent("themechange", { detail: { dark } }));
}

export function applyAppearance(m) {
  mode = ["light", "dark"].includes(m) ? m : "auto";
  paint();
}

export const isDark = () => document.body.classList.contains("dark");

media.addEventListener("change", () => mode === "auto" && paint());
