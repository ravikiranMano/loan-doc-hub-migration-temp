## Root cause

`DateMaskedInput` inside `src/components/deal/DealFieldInput.tsx` (lines 56–72) keeps its own local `typed` state for the visible MM/DD/YYYY text and only re-syncs to the upstream `displayValue` when the input is **not** focused:

```ts
const [typed, setTyped] = useState<string>(displayValue);
React.useEffect(() => {
  if (document.activeElement !== inputRef.current) {
    setTyped(displayValue);
    setTypedError(false);
  }
}, [displayValue]);
```

Repro path that breaks:
1. User types `06/15/2026` into the input → input has focus, `typed = "06/15/2026"`, canonical is saved.
2. User clicks the calendar icon and picks `11/03/2024`.
3. The text input often retains focus (the popover trigger is a sibling button, and React’s Popover doesn’t blur the input). `handleDateSelect` runs, parent `value` becomes `2024-11-03`, so `displayValue` recomputes to `11/03/2024`.
4. The sync effect fires but `document.activeElement === inputRef.current`, so it bails. `typed` stays `06/15/2026`. Storage is correct; only the visible text is stale — exactly the reported symptom.

`TypableDateField` (`src/components/ui/typable-date-field.tsx`) has the identical focus-gated sync (lines 116–121) but its calendar `onSelect` calls `setTyped(format(...))` explicitly, so it’s safer. We’ll harden it the same way for parity.

## Fix

Distinguish **“user is typing”** from **“value changed externally”** instead of using focus as the gate.

Track the canonical value last produced by *our own* keystroke handler. Any other change to the upstream canonical value is, by definition, external (calendar pick, Clear, Today, record load, programmatic reset) and must overwrite `typed` even when the input is focused.

### `src/components/deal/DealFieldInput.tsx` — `DateMaskedInput`

- Add `lastSelfCanonicalRef = useRef<string | null>(null)`.
- In `handleTextChange`, when calling `onChangeCanonical(...)`, set `lastSelfCanonicalRef.current = <value just pushed up>` (both the empty-string branch and the parsed-date branch).
- Replace the sync effect so it depends on the canonical `value` (not just `displayValue`) and re-syncs whenever the incoming canonical value differs from what we last pushed up ourselves:
  ```ts
  React.useEffect(() => {
    if (value !== lastSelfCanonicalRef.current) {
      // External change: calendar pick, Clear, Today, parent reset.
      setTyped(displayValue);
      setTypedError(false);
      lastSelfCanonicalRef.current = value;
    }
  }, [value, displayValue]);
  ```
- Initialize `lastSelfCanonicalRef.current = value` on mount so the first user keystroke isn’t treated as external.

This guarantees calendar Select / Clear / Today / record-load always refresh the full MM/DD/YYYY, while keystrokes never clobber the user’s in-progress text or reset the caret (the existing `requestAnimationFrame` caret-restore stays intact and only runs inside `handleTextChange`).

### `src/components/ui/typable-date-field.tsx` — `TypableDateField`

Apply the same `lastSelfCanonicalRef` pattern to the effect at lines 116–121:

- In `handleChange`, set `lastSelfCanonicalRef.current` to whatever it passes to `onChange` (`''` on clear, `formatDateOnly(parsed)` on full 8-digit commit).
- In `commit` (blur), do the same on success.
- In the sync effect, re-sync `typed` from `upstreamDisplay` whenever `value !== lastSelfCanonicalRef.current`, regardless of focus.
- Leave the existing `useLayoutEffect` caret-restore alone (it only runs when `pendingCaretRef.current != null`, which is set only by keystrokes — external syncs won’t trigger it, so no caret jump).

## Out of scope

- No changes to `dateOnly.ts`, storage format, calendar UI, or parent forms.
- No data/merge/save logic changes.
- `PropertyLiensForm`’s read-only popover trigger (no manual typing) doesn’t exhibit the bug; no change needed.

## Verification

- Type `06/15/2026` → pick `11/03/2024` → field shows `11/03/2024` fully.
- Pick → Clear → pick again → display always matches.
- Today button updates display.
- Load existing record → display matches stored value.
- Typing: caret stays put, partials like `06/14/192` aren’t clobbered, no cursor jump to end.
- Manual typing of full date still updates calendar selection (reverse direction unchanged).
