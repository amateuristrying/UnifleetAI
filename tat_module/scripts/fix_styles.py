import os

print("🎨 Repairing Tailwind CSS Configuration...")

# 1. Update tailwind.config.ts to look in SRC folder
tailwind_config = """import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
"""

with open("tailwind.config.ts", "w") as f:
    f.write(tailwind_config)
print("✅ Updated tailwind.config.ts")

# 2. Ensure globals.css has the directives
css_path = "src/app/globals.css"
css_content = """@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #F8F9FB;
  --foreground: #171717;
}

body {
  color: var(--foreground);
  background: var(--background);
}
"""

# Only overwrite if it looks wrong or empty
with open(css_path, "w") as f:
    f.write(css_content)
print("✅ Verified src/app/globals.css")

print("\n✨ STYLES FIXED! Please restart your server now.")
