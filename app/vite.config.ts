import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@domain": fileURLToPath(new URL("./src/domain", import.meta.url)),
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@infra": fileURLToPath(new URL("./src/infra", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
    },
  },
  server: { port: 5190 }, // puerto asignado a RestaurantOS (PLAN.md §12; 3000 y 5180 ocupados)
});
