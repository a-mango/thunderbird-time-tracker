# Third-party material

## Thunderbird icons and design tokens

- **What**: the SVG icons in `src/ui/icons/*.svg` and the token values in `src/ui/styles/tokens.css`.
- **From**: Thunderbird, <https://github.com/thunderbird/thunderbird-desktop>, tag `THUNDERBIRD_157_0_RELEASE`.
  Icons come from `mail/themes/shared/mail/icons/new/`, tokens from `mail/themes/shared/mail/*.css`.
- **License**: Mozilla Public License 2.0, <https://mozilla.org/MPL/2.0/>. Each file keeps its MPL header.
- **Changes**: `scripts/import-icons.mjs` rewrites the icons' context paint (`context-fill`,
  `context-stroke`) to `currentColor`, removes inner comments, and adds an `id` for `<use>`.
  Each icon records its source path and these changes in a comment after the MPL header.
  `ICONS.txt` lists the imported files.
