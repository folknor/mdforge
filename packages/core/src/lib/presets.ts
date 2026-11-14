/**
 * Browser-safe preset data
 * No Node.js dependencies - can be used in renderer/browser contexts
 */

/** Available themes */
export const themes = ["beryl", "tufte", "buttondown", "pandoc"] as const;

export type Theme = (typeof themes)[number];

/** Font pairing preset names with display labels */
export const fontPairingPresets = [
  { value: "beryl", label: "Beryl (Noto Sans)" },
  { value: "tufte", label: "Tufte (Palatino)" },
  { value: "buttondown", label: "Buttondown (Georgia)" },
  { value: "pandoc", label: "Pandoc (Georgia)" },
  { value: "modern-professional", label: "Modern Professional (Inter)" },
  { value: "classic-elegant", label: "Classic Elegant (Playfair Display)" },
  { value: "modern-geometric", label: "Modern Geometric (Poppins)" },
  { value: "tech-minimal", label: "Tech Minimal (Space Grotesk)" },
  { value: "editorial", label: "Editorial (Cormorant Garamond)" },
  { value: "clean-sans", label: "Clean Sans (DM Sans)" },
] as const;

export type FontPairingPreset = (typeof fontPairingPresets)[number]["value"];
