// Applies the signed-in user's theme before the page paints. ThemeProvider sets data-theme in an
// effect, which runs after the first paint — so every full reload in dark mode flashed the light
// theme first. This inline script runs as the HTML is parsed, ahead of the content below it.
// On client-side navigation React doesn't run it again; ThemeProvider has taken over by then.

/** A JSON literal that can't close the script tag it sits in: JSON.stringify leaves `<` as is. */
const literal = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c')

export default function ThemeScript({ mode, accent }: { mode: string; accent: string }) {
  const js = `(function(){try{var m=${literal(mode)};var d=m==='auto'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):m;var r=document.documentElement;r.setAttribute('data-theme',d);var a=${literal(accent)};if(/^#[0-9a-fA-F]{6}$/.test(a))r.style.setProperty('--accent',a);}catch(e){}})();`
  return <script dangerouslySetInnerHTML={{ __html: js }} />
}
