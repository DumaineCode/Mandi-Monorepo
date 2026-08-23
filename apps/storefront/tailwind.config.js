const path = require("path")

module.exports = {
  darkMode: "class",
  presets: [require("@medusajs/ui-preset")],
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/modules/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      transitionProperty: {
        width: "width margin",
        height: "height",
        bg: "background-color",
        display: "display opacity",
        visibility: "visibility",
        padding: "padding-top padding-right padding-bottom padding-left",
      },
      colors: {
        grey: {
          0: "#FFFFFF",
          5: "#F9FAFB",
          10: "#F3F4F6",
          20: "#E5E7EB",
          30: "#D1D5DB",
          40: "#9CA3AF",
          50: "#6B7280",
          60: "#4B5563",
          70: "#374151",
          80: "#1F2937",
          90: "#111827",
        },
        // Variation 1 — "Morado dominante": the dark base becomes deep purple.
        // `ink` is both a dark surface (Hero/Newsletter) AND body text on light
        // surfaces, so it stays a very dark plum that reads as near-black on cream
        // but glows purple as a full background.
        cream: "#F4EFE4",
        paper: "#FCFAF3",
        ink: "#3a1645",
        coral: {
          DEFAULT: "#9d6e9f",
          hover: "#b489b6",
          light: "#cbb0cc",
          foreground: "#fcf5dd",
        },
        teal: "#9bd5e7",
        gold: "#F2B544",
        line: "#E4DCCB",
        "ink-muted": "#6e4a72",
        "ink-soft": "#5a3a5e",
        "cream-muted": "#dccadf",
        "cream-soft": "#bfa6c2",
        // Hero headline palette, sampled from the design assets. The headline
        // plum sits between `ink` and `ink-soft`; none of the highlighter
        // swipes matched an existing token. The accent dot reuses `teal` and
        // the pill label reuses plain `white`.
        //
        // Four measured swipe colours, one per slide — peers, with no default
        // among them. Each slide picks exactly one by name in `hero/slides.ts`.
        "hero-headline": "#5E1F5B",
        "hero-highlight-lilac": "#D7B1D4",
        "hero-highlight-yellow": "#FED143",
        "hero-highlight-pink": "#E72564",
        "hero-highlight-blue": "#1D8DB3",
      },
      borderRadius: {
        none: "0px",
        soft: "2px",
        base: "4px",
        rounded: "8px",
        large: "16px",
        circle: "9999px",
      },
      maxWidth: {
        "8xl": "100rem",
      },
      screens: {
        "2xsmall": "320px",
        xsmall: "512px",
        small: "1024px",
        medium: "1280px",
        large: "1440px",
        xlarge: "1680px",
        "2xlarge": "1920px",
      },
      fontSize: {
        "3xl": "2rem",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Ubuntu",
          "sans-serif",
        ],
        blusans: ["var(--font-blusans)", "sans-serif"],
        bricolage: ["var(--font-bricolage)", "sans-serif"],
        hanken: ["var(--font-hanken)", "sans-serif"],
        mono: ["var(--font-space-mono)", "monospace"],
      },
      keyframes: {
        scrollx: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },

        // --- Payment status modal ------------------------------------------
        //
        // CSS keyframes over an animation library on purpose. The checkout is
        // the highest-intent page in the funnel and `design.md` D1 already
        // rejected a 13-40 kB state library for it; a Lottie runtime or
        // framer-motion would cost more than both for four shapes that move.
        // Every one of these degrades to a static frame under
        // `motion-reduce:`, which the components apply.

        /**
         * The verdict marks — the cross and the check — arriving.
         *
         * Overshoots to 1.12 and settles. A linear scale-in reads as a shape
         * being drawn; the overshoot reads as an answer landing, which is what
         * this is. Deliberately short: it is in front of someone waiting to
         * find out whether they have been charged.
         */
        "verdict-pop": {
          "0%": { opacity: "0", transform: "scale(0.4)" },
          "60%": { opacity: "1", transform: "scale(1.12)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        /**
         * A short lateral shake under the cross. Two cycles, six pixels — a
         * rejection should register as a rejection without being punitive
         * about it, and this runs at the moment someone has just been told
         * their card did not work.
         */
        "verdict-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-6px)" },
          "40%": { transform: "translateX(5px)" },
          "60%": { transform: "translateX(-3px)" },
          "80%": { transform: "translateX(2px)" },
        },
        /**
         * The parcel crossing its track on success.
         *
         * Ends at `translateX(0)` and holds — paired with `forwards`, so the
         * box comes to rest under the check rather than snapping back to the
         * start. The whole run has to fit inside the confirmation redirect,
         * which `placeOrder` fires from the server action, so it is 900 ms and
         * not the two seconds the gesture would like.
         */
        "parcel-travel": {
          "0%": { opacity: "0", transform: "translateX(-140%)" },
          "25%": { opacity: "1" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        /**
         * The expanding halo behind the processing icon. Fades as it grows so
         * it reads as a pulse rather than a spinner: this state can last three
         * seconds against a bank, and a spinner that long reads as stuck.
         */
        "pulse-halo": {
          "0%": { opacity: "0.5", transform: "scale(0.85)" },
          "100%": { opacity: "0", transform: "scale(1.6)" },
        },
        /**
         * The dashed line the parcel travels along, drawn left to right.
         * `stroke-dashoffset` on a plain `<hr>`-like element is not available,
         * so this animates a background-size instead.
         */
        "track-draw": {
          "0%": { backgroundSize: "0% 100%" },
          "100%": { backgroundSize: "100% 100%" },
        },
        ring: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "fade-in-right": {
          "0%": {
            opacity: "0",
            transform: "translateX(10px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateX(0)",
          },
        },
        "fade-in-top": {
          "0%": {
            opacity: "0",
            transform: "translateY(-10px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "fade-out-top": {
          "0%": {
            height: "100%",
          },
          "99%": {
            height: "0",
          },
          "100%": {
            visibility: "hidden",
          },
        },
        "accordion-slide-up": {
          "0%": {
            height: "var(--radix-accordion-content-height)",
            opacity: "1",
          },
          "100%": {
            height: "0",
            opacity: "0",
          },
        },
        "accordion-slide-down": {
          "0%": {
            "min-height": "0",
            "max-height": "0",
            opacity: "0",
          },
          "100%": {
            "min-height": "var(--radix-accordion-content-height)",
            "max-height": "none",
            opacity: "1",
          },
        },
        enter: {
          "0%": { transform: "scale(0.9)", opacity: 0 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
        leave: {
          "0%": { transform: "scale(1)", opacity: 1 },
          "100%": { transform: "scale(0.9)", opacity: 0 },
        },
        "slide-in": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(0)" },
        },
        // Hero slider. `hero-media-in` settles the artwork; `hero-text-in` is
        // the delayed rise of the real HTML headline layered on top of it.
        "hero-media-in": {
          "0%": { opacity: "0", transform: "scale(1.05)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "hero-text-in": {
          "0%": {
            opacity: "0",
            transform: "translate3d(0, 28px, 0) scale(0.985)",
          },
          "100%": {
            opacity: "1",
            transform: "translate3d(0, 0, 0) scale(1)",
          },
        },
      },
      animation: {
        marquee: "scrollx 30s linear infinite",

        // --- Payment status modal ------------------------------------------
        "verdict-pop":
          "verdict-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "verdict-shake": "verdict-shake 420ms ease-in-out 120ms both",
        /**
         * `both` + a delay so the parcel waits for the panel's own 300 ms
         * entrance before it sets off. Without it the box is already halfway
         * across before the dialog has finished scaling in, and the two
         * motions fight.
         */
        "parcel-travel":
          "parcel-travel 900ms cubic-bezier(0.22, 0.61, 0.36, 1) 120ms both",
        "pulse-halo": "pulse-halo 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "track-draw": "track-draw 900ms cubic-bezier(0.22, 0.61, 0.36, 1) 120ms both",
        ring: "ring 2.2s cubic-bezier(0.5, 0, 0.5, 1) infinite",
        "fade-in-right":
          "fade-in-right 0.3s cubic-bezier(0.5, 0, 0.5, 1) forwards",
        "fade-in-top": "fade-in-top 0.2s cubic-bezier(0.5, 0, 0.5, 1) forwards",
        "fade-out-top":
          "fade-out-top 0.2s cubic-bezier(0.5, 0, 0.5, 1) forwards",
        "accordion-open":
          "accordion-slide-down 300ms cubic-bezier(0.87, 0, 0.13, 1) forwards",
        "accordion-close":
          "accordion-slide-up 300ms cubic-bezier(0.87, 0, 0.13, 1) forwards",
        enter: "enter 200ms ease-out",
        "slide-in": "slide-in 1.2s cubic-bezier(.41,.73,.51,1.02)",
        leave: "leave 150ms ease-in forwards",
        "hero-media-in": "hero-media-in 1100ms cubic-bezier(.22,.61,.36,1) both",
        // `both` is load-bearing: the final frame persists after the animation
        // ends, which is why the centering transform MUST live on a different
        // element (the hero component explains the rest).
        "hero-text-in":
          "hero-text-in 900ms cubic-bezier(.22,.61,.36,1) 260ms both",
      },
    },
  },
  plugins: [require("tailwindcss-radix")()],
}
