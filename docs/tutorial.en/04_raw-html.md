# 4. Raw HTML

## 4.1 When to use raw HTML

You can use inline or block-level raw HTML for layouts and components that Markdown alone cannot express easily. Prefer GFM syntax for features it already supports, such as tables and emphasis (Chapter 03), and reserve raw HTML for the rest.

> **Warning**: during conversion, the browser loads raw HTML and executes its scripts as written. pfpdf is a tool for converting your own trusted documents; it does not sandbox or sanitize raw HTML. Do not use pfpdf to convert Markdown files of unknown origin. See Chapter 08, "Security model," in the design documents for details.

## 4.2 Inline HTML

You can mix HTML elements into running text. Converting the following Markdown to PDF displays the shortcut as <kbd>Ctrl</kbd> + <kbd>C</kbd>. You can also use `<sub>` and `<sup>` for <sub>subscript</sub> and <sup>superscript</sup>.

```md
Press <kbd>Ctrl</kbd> + <kbd>C</kbd>.
```

## 4.3 Block HTML

Block-level elements such as `div`, `section`, `figure`, and `table` are also available. Converting the following example from Markdown to PDF produces a box with centered text.

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

`<base>`, `<meta http-equiv="refresh">`, and `data-pfpdf-*` attributes are also preserved as trusted HTML, but they may affect pfpdf's URL resolution or what it renders. If you use the API to register work that must finish before pagination, do not overwrite `window.pfpdf` (Section 4.5).

## 4.4 Styling with `<style>`

You can add CSS to the document in a `<style>` element. Converting the following example from Markdown to PDF gives the area with the `.tutorial-note` class a left border and a background color.

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

You can also add `<script>` elements when needed. Synchronous scripts run before PDF pagination. If a script error or an unhandled promise rejection is detected before the document becomes ready, conversion fails with exit code `1`.

Math is rendered and code is highlighted before the HTML is assembled. In the browser, pfpdf waits for the HTML document to finish parsing and for registered promises to complete, then waits for fonts to be ready. It checks that the `img` elements present at that point have loaded and can be decoded before starting pagination. If an image fails to load or decode, conversion fails, whether the image refers to a local file, a remote URL, or a data URL.

Conversion also fails if a loading error in a statically referenced local stylesheet or script is detected before the document becomes ready. pfpdf does not guarantee that it monitors every fetch result for remote stylesheets and scripts.

For asynchronous work that must finish before pagination, explicitly register a promise as follows.

```html
<script>
  window.pfpdf.registerReady(loadChartData().then(drawChart));
</script>
```

In this example, you provide the `loadChartData` and `drawChart` functions.

Register promises before the document finishes parsing. Registering later is an error. pfpdf does not automatically determine when unregistered timers, event handlers, or workers have finished. Script errors and unhandled promise rejections after the document becomes ready are not reflected in the conversion result. Always register asynchronous work required for rendering, and make sure it completes within `--render-timeout-ms`.

During conversion, `window.location` contains a loopback port that differs on every run. For reproducible documents, do not use `location.href` / `origin`, the current time, or random numbers in rendered content or document IDs.

## 4.6 Referencing local files and remote resources

- Relative resource URLs in raw HTML, such as those for images, stylesheets, and scripts, are resolved against the directory containing the Markdown file where the HTML is written. This applies to static URLs in `src` / `href` / `srcset` attributes, inline styles, and `<style>`
- A static reference can point to any local file readable by the pfpdf process, including through an absolute path or a path containing `..`
- CSS `@import` and `url()` are resolved recursively against the CSS file itself. Circular `@import`s do not cause infinite loops: pfpdf skips an import if it refers back to a file already being parsed
- Local paths that a script assembles at runtime are not resolved as static references and are not guaranteed to work
- JavaScript module dependencies and resource references inside nested HTML documents are not analyzed. Inline modules and `iframe[srcdoc]` themselves are preserved, but relative references to local resources inside them are not guaranteed to resolve
- Remote `https:` images, stylesheets, and scripts are fetched directly by the browser. The results depend on the network and the remote source at the time of conversion. For reproducible documents, avoid remote resources and keep the files in the repository
