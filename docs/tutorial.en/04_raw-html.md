# 4. Raw HTML

## 4.1 When to use raw HTML

You can use inline or block-level raw HTML for layouts and components that Markdown alone cannot express easily. Prefer GFM syntax for features it already supports, such as tables and emphasis (Chapter 03), and reserve raw HTML for the rest.

> **Warning**: raw HTML and `<script>` are executed as-is in the browser during conversion. pfpdf is a tool for converting your own trusted documents; it does not sandbox or sanitize raw HTML. Do not use pfpdf to convert Markdown files of unknown origin. See the security chapter of the design documents for details.

## 4.2 Inline HTML

You can mix HTML elements into running text — for example, keyboard shortcuts like <kbd>Ctrl</kbd> + <kbd>C</kbd>, or <sub>subscript</sub> and <sup>superscript</sup>.

```md
Press <kbd>Ctrl</kbd> + <kbd>C</kbd>.
```

## 4.3 Block HTML

Block-level elements such as `div`, `section`, `figure`, and `table` are also available.

<figure style="text-align: center; border: 1px solid #ccc; padding: 1em;">
  <figcaption>Example of a figure element with a style attribute</figcaption>
  <p>This box is built with a raw HTML <code>figure</code>.</p>
</figure>

```md
<figure style="text-align: center; border: 1px solid #ccc; padding: 1em;">
  <figcaption>Example of a figure element with a style attribute</figcaption>
  <p>This box is built with a raw HTML <code>figure</code>.</p>
</figure>
```

Under the GFM block rules, Markdown syntax inside an HTML block may not be interpreted. Keep content that must be parsed as Markdown outside the HTML block. An HTML block also cannot span multiple Markdown files.

`<base>`, `<meta http-equiv="refresh">`, and `data-pfpdf-*` attributes are also preserved as trusted HTML, but they may conflict with pfpdf's URL resolution and readiness handling. Avoid replacing `window.pfpdf`, as doing so causes a readiness error.

## 4.4 Styling with `<style>`

You can style the document by adding a `<style>` element.

<style>
.tutorial-note {
  border-left: 4px solid #4a90d9;
  padding: 0.5em 1em;
  background: #f0f6fc;
}
</style>

<div class="tutorial-note">
This box uses a class defined in a <code>style</code> element inside the document.
</div>

```md
<style>
.tutorial-note {
  border-left: 4px solid #4a90d9;
  padding: 0.5em 1em;
  background: #f0f6fc;
}
</style>

<div class="tutorial-note">
This box uses a class defined in a <code>style</code> element inside the document.
</div>
```

## 4.5 Using `<script>`

You can also add `<script>` elements when needed. Synchronous scripts run before PDF pagination. An error or unhandled promise rejection before the document becomes ready causes conversion to fail with exit code `1`.

pfpdf waits for the DOM, static local stylesheets and scripts, fonts, images, math, and code highlighting before starting pagination. Completion or failure of remote resources is not tracked with the same precision.

For asynchronous work that must finish before pagination, explicitly register a promise as follows.

```html
<script>
  window.pfpdf.registerReady(loadChartData().then(drawChart));
</script>
```

Registering after the document has finished parsing is an error. pfpdf cannot automatically detect unregistered timers, event handlers, workers, or errors that occur after readiness completes. Always register any work required for rendering, and make sure it completes within `--render-timeout-ms`.

During conversion, `window.location` contains a loopback port that differs on every run. For reproducible documents, do not use `location.href` / `origin`, the current time, or random numbers in rendered content or document IDs.

## 4.6 Referencing local files and remote resources

- Static URLs in raw HTML `src` / `href` / `srcset` attributes, inline styles, and `<style>` are resolved against the input's resource base
- Any local file readable by the pfpdf process can be referenced — even via absolute paths or paths containing `..` — as long as it is written statically
- CSS `@import` and `url()` are resolved recursively against the CSS file itself. Circular `@import`s are each parsed once and do not cause infinite loops
- Local paths that a script assembles at runtime fall outside the scope of static resources and are not guaranteed to work
- JavaScript local module graphs and resource graphs inside nested HTML documents are not analyzed. Inline modules and `iframe[srcdoc]` themselves are preserved, but relative local resources inside them are not guaranteed to resolve
- Remote `https:` images, stylesheets, and scripts are fetched directly by the browser; pfpdf does not guarantee that the fetch succeeds or is reproducible. For reproducible documents, avoid remote resources and keep the files in the repository
