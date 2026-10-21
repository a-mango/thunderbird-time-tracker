// Tag-name typings for the tt-* custom elements, so el('tt-tree') and querySelector are typed.
// Not shipped (types/ is excluded from the XPI).
import type { TtDialog } from '../ui/components/tt-dialog.js';
import type { TtNotificationBar } from '../ui/components/tt-notification-bar.js';
import type { TtSplitter } from '../ui/components/tt-splitter.js';
import type { TtTable } from '../ui/components/tt-table.js';
import type { TtTree } from '../ui/components/tt-tree.js';

declare global {
  interface HTMLElementTagNameMap {
    'tt-dialog': TtDialog;
    'tt-notification-bar': TtNotificationBar;
    'tt-splitter': TtSplitter;
    'tt-table': TtTable;
    'tt-tree': TtTree;
  }
}
