# Editorial Landing Page Design System

A reusable design system for building clean, high-contrast, editorial-style landing pages. Framework: React + Tailwind CSS + shadcn/ui. Adapt the content and components to any product.

---

## Philosophy

- **Black and white primary.** Buttons are black in light mode, white in dark mode. No colored primary accents.
- **Typography does the work.** Large bold headlines, muted secondary text, monospace micro-labels. No gradients, no illustrations, no hero images.
- **Flat, not carded.** Sections separated by `border-t` dividers, not Card wrappers or background fills.
- **Restrained palette.** Only three tones: `text-foreground` (black/white), `text-muted-foreground` (gray), and semantic colors (emerald for success, etc.) used sparingly.
- **Asymmetric layouts.** Left-heavy content grids (`grid-cols-[1fr,2fr]`) with editorial left-aligned section labels.
- **Monospace accents.** Section labels use `font-mono uppercase tracking-widest` at `text-xs` in `text-muted-foreground`.
- **Generous whitespace.** `py-24 px-6` on sections, `gap-16` between grid columns.

---

## Color System (CSS Custom Properties)

```css
/* LIGHT MODE */
:root {
  --background: 0 0% 100%;           /* pure white */
  --foreground: 220 13% 13%;         /* near-black */
  --primary: 220 13% 13%;            /* black buttons */
  --primary-foreground: 0 0% 100%;   /* white text on buttons */
  --muted-foreground: 220 9% 40%;    /* gray body text */
  --accent: 220 14% 92%;             /* subtle gray backgrounds */
  --card: 0 0% 98%;                  /* barely off-white cards */
  --border: 220 13% 91%;             /* light gray borders */
}

/* DARK MODE */
.dark {
  --background: 220 13% 9%;          /* near-black */
  --foreground: 0 0% 98%;            /* near-white */
  --primary: 0 0% 98%;               /* white buttons */
  --primary-foreground: 220 13% 9%;  /* black text on buttons */
  --muted-foreground: 220 9% 65%;    /* gray body text */
  --accent: 220 14% 16%;             /* subtle dark backgrounds */
  --card: 220 13% 11%;               /* slightly lighter than bg */
  --border: 220 13% 18%;             /* dark gray borders */
}
```

Key rule: All values are `H S% L%` (space-separated, no `hsl()` wrapper). Tailwind resolves them via `hsl(var(--variable))`.

---

## Typography Scale

| Element | Classes |
|---------|---------|
| Hero headline | `text-4xl sm:text-5xl font-bold tracking-tight leading-[1.12]` |
| Section headline | `text-2xl sm:text-3xl font-bold tracking-tight leading-snug` |
| Section label (mono) | `text-xs font-mono uppercase tracking-widest text-muted-foreground` |
| Body text | `text-base text-muted-foreground leading-relaxed` |
| Small body | `text-sm text-muted-foreground leading-relaxed` |
| Micro text | `text-[10px] text-muted-foreground` |
| Feature title | `text-sm font-semibold` |
| Nav brand | `text-sm font-semibold tracking-tight` |

### Headline Pattern: Bold + Muted Alternation

Use `text-muted-foreground` on one line to create visual rhythm:

```jsx
<h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.12]">
  First Line Bold.<br />
  <span className="text-muted-foreground">Second Line Muted.</span><br />
  Third Line Bold.
</h1>
```

---

## Page Structure

### Nav (fixed, blurred)

```jsx
<nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b">
  <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <YourIcon className="w-5 h-5 text-foreground" />
      <span className="text-sm font-semibold tracking-tight">Brand</span>
    </div>
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" className="text-xs h-8">Sign in</Button>
      <Button size="sm" className="text-xs h-8">Get started</Button>
    </div>
  </div>
</nav>
```

### Hero Section (asymmetric two-column)

```jsx
<section className="pt-28 pb-20 px-6">
  <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-start">
    {/* Left: copy */}
    <div className="space-y-8 pt-8">
      <div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.12] mb-5">
          Line one.<br />
          <span className="text-muted-foreground">Line two muted.</span><br />
          Line three.
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed max-w-md">
          Subtitle description here.
        </p>
      </div>

      {/* Optional: interactive demo box */}
      <div className="rounded-lg border bg-card/50 p-4 max-w-md">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 font-medium">
          Label
        </p>
        {/* Demo component */}
      </div>

      {/* CTA buttons */}
      <div className="flex items-center gap-3">
        <Button size="lg" className="h-11 px-6 gap-2 text-sm">
          Start for free
          <ArrowRight className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground">
          Learn more
        </Button>
      </div>
    </div>

    {/* Right: preview component (desktop only) */}
    <div className="hidden lg:flex flex-col items-end gap-6 pt-4">
      {/* Product preview card or visual */}
    </div>
  </div>
</section>
```

### Content Section (editorial left-label layout)

```jsx
<section className="py-24 px-6 border-t">
  <div className="max-w-6xl mx-auto">
    <div className="grid lg:grid-cols-[1fr,2fr] gap-16">
      {/* Left: section label + headline */}
      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Section Label
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug">
          Headline that<br />spans two lines.
        </h2>
      </div>

      {/* Right: content grid */}
      <div className="grid sm:grid-cols-3 gap-8">
        {items.map(({ num, icon: Icon, title, body }) => (
          <div key={num}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-mono text-muted-foreground/40">{num}</span>
              <Icon className="w-4 h-4 text-foreground" />
            </div>
            <h3 className="text-sm font-semibold mb-2">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
</section>
```

### Features Grid (2-column variant)

```jsx
<div className="grid sm:grid-cols-2 gap-x-12 gap-y-8">
  {features.map(({ title, body }) => (
    <div key={title}>
      <h3 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
        {title}
        <ArrowUpRight className="w-3 h-3 text-muted-foreground/30" />
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  ))}
</div>
```

### Footer (minimal)

```jsx
<footer className="border-t py-6 px-6">
  <div className="max-w-6xl mx-auto flex items-center justify-between">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <YourIcon className="w-3 h-3" />
      <span>Brand</span>
    </div>
    <p className="text-[10px] text-muted-foreground/40 font-mono">Tagline</p>
  </div>
</footer>
```

---

## Component Patterns

### Preview Card (for hero right column)

```jsx
<div className="rounded-xl border bg-card/80 backdrop-blur-sm p-5 space-y-4 max-w-sm w-full">
  {/* Header row */}
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center">
        <span className="text-xs font-bold text-white">A</span>
      </div>
      <div>
        <p className="text-sm font-semibold">Company Name</p>
        <p className="text-[10px] text-muted-foreground">Category</p>
      </div>
    </div>
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
      Status
    </span>
  </div>

  {/* Description */}
  <p className="text-xs text-muted-foreground leading-relaxed">
    Description text here.
  </p>

  {/* Tags */}
  <div className="flex gap-1.5 flex-wrap">
    {tags.map((tag) => (
      <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-accent text-muted-foreground">
        {tag}
      </span>
    ))}
  </div>

  {/* Footer stats */}
  <div className="border-t pt-3 space-y-1.5">
    <div className="flex items-center gap-1.5">
      <CheckIcon className="w-3 h-3 text-emerald-500" />
      <span className="text-[10px] text-muted-foreground">Status line</span>
    </div>
  </div>
</div>
```

### Typing Demo (animated input simulation)

```jsx
const INPUTS = ["example.com", "Some query", "another-input"];

function TypingDemo() {
  const [inputIndex, setInputIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState("typing"); // "typing" | "pause" | "clearing"

  useEffect(() => {
    let timer;
    const current = INPUTS[inputIndex];

    if (phase === "typing") {
      if (charIndex < current.length) {
        timer = setTimeout(() => setCharIndex(c => c + 1), 45 + Math.random() * 35);
      } else {
        timer = setTimeout(() => setPhase("pause"), 2200);
      }
    } else if (phase === "pause") {
      timer = setTimeout(() => setPhase("clearing"), 100);
    } else if (phase === "clearing") {
      if (charIndex > 0) {
        timer = setTimeout(() => setCharIndex(c => c - 1), 20);
      } else {
        setInputIndex(i => (i + 1) % INPUTS.length);
        setPhase("typing");
      }
    }
    return () => clearTimeout(timer);
  }, [charIndex, phase]);

  return (
    <div className="font-mono text-sm">
      <span className="text-foreground">{INPUTS[inputIndex].slice(0, charIndex)}</span>
      <span className="inline-block w-[2px] h-[14px] bg-foreground animate-pulse ml-[1px] align-middle" />
    </div>
  );
}
```

### Pipeline/Progress Visual

```jsx
<div className="space-y-2 max-w-sm w-full">
  {steps.map((step) => (
    <div key={step.label} className="flex items-center gap-3">
      <div className={`w-1.5 h-1.5 rounded-full ${step.done ? step.color : step.color + " animate-pulse"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{step.label}</span>
          {step.done && <span className="text-[9px] text-emerald-500">done</span>}
          {!step.done && <span className="text-[9px] text-muted-foreground animate-pulse">running</span>}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{step.detail}</p>
      </div>
    </div>
  ))}
</div>
```

---

## Rules to Follow

1. **Never use `text-primary` as an accent.** Since primary = black/white, use `text-foreground` for emphasis and `text-muted-foreground` for secondary text.
2. **No Card wrappers on sections.** Use `border-t` to separate sections. The only Card-like element is the hero preview component.
3. **No colored backgrounds on sections.** Sections share the same `bg-background`. Differentiation comes from spacing and dividers.
4. **Icons are `text-foreground` or `text-muted-foreground`.** Never colored unless semantically meaningful (emerald for verified, etc.).
5. **Buttons are solid black/white only.** Use `variant="ghost"` for secondary actions with `text-muted-foreground`.
6. **Section labels are always:** `text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3`.
7. **Step numbers use:** `text-[10px] font-mono text-muted-foreground/40`.
8. **Tags/chips use:** `text-[10px] px-2 py-0.5 rounded bg-accent text-muted-foreground`.
9. **Max width:** `max-w-6xl mx-auto` for all sections. `max-w-md` for body text.
10. **Content sections always use the asymmetric grid:** `grid lg:grid-cols-[1fr,2fr] gap-16`. Left = label + headline. Right = content.
11. **Fonts:** Inter for body, JetBrains Mono for monospace accents. Define in CSS variables: `--font-sans`, `--font-mono`.
12. **Shadows are zero.** All shadow values are set to `0.00` opacity. Elevation comes from borders and background tints, not drop shadows.

---

## Adapting to a New Product

1. **Replace the brand icon and name** in nav and footer.
2. **Rewrite the hero headline** using the bold/muted alternation pattern.
3. **Replace the hero preview card** with a relevant product preview.
4. **Replace the typing demo inputs** with examples relevant to your product.
5. **Rewrite the "How it works" steps** (keep the numbered icon layout).
6. **Rewrite the features grid** (keep the 2-column layout with ArrowUpRight icons).
7. **Keep all spacing, typography, and color decisions identical.** The system works because of its consistency.

---

## Quick Checklist

- [ ] Primary color = black (light) / white (dark)
- [ ] No colored accent text anywhere
- [ ] Nav: fixed, blurred, `h-14`, ghost + solid CTA buttons
- [ ] Hero: asymmetric 2-col, headline with muted span, subtitle, CTA row
- [ ] Sections: `py-24 px-6 border-t`, `grid-cols-[1fr,2fr]`
- [ ] Section labels: mono, uppercase, tracking-widest, muted
- [ ] Features: `text-sm font-semibold` title, `text-sm text-muted-foreground` body
- [ ] Footer: minimal, `border-t py-6`, brand icon + tagline
- [ ] All shadows at zero opacity
- [ ] No Card wrappers on main sections
- [ ] Dark mode fully supported via CSS custom properties
