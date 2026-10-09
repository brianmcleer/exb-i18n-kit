# Wiring a translator into a widget

`extract` only rewrites code where a translator is already in scope. Since 1.1, `localize` follows it
with `wire`, which handles those spots itself through a shared helper (`src/<part>/i18n-t.ts`). Use the
patterns below when you prefer a hand-written translator, or for code `wire` reports as "by hand".

## Class component (widget.tsx, setting.tsx)

```tsx
import defaultMessages from './translations/default'

export default class Widget extends React.PureComponent<AllWidgetProps<IMConfig>, State> {
  // Uses the widget's intl (EB injects props.intl); English defaults when absent.
  nls = (id: string, values?: Record<string, any>): string =>
    this.props.intl
      ? this.props.intl.formatMessage({ id, defaultMessage: defaultMessages[id] }, values)
      : String(defaultMessages[id] ?? id).replace(/\{(\w+)\}/g, (m, k) => (values?.[k] != null ? String(values[k]) : m))
}
```

## Function component

```tsx
import { hooks } from 'jimu-core'
import defaultMessages from './translations/default'

const Panel = (props) => {
  const t = hooks.useTranslation(defaultMessages)
  return <span>{t('deleteAll')}</span>
}
```

`hooks.useTranslation` reads the widget's intl from context, so it works in any component
rendered inside the widget.

## Child component that receives props

Pass the parent's translator down and use it as `props.nls`:

```tsx
<UnitEditor nls={this.nls} />

const UnitEditor = (props) => {
  const nls = (id: string, values?: Record<string, any>) => props.nls ? props.nls(id, values) : (defaultMessages[id] ?? id)
  ...
}
```

## Module-level helpers

Functions outside any component have no intl. Give them a translator parameter
(`function describe (shape, t) { return t('shapeArea', { area }) }`) and pass `t` or
`this.nls` from the caller.

## Settings panel

The settings panel has its own `src/setting/translations/default.ts` and the same
`props.intl`. Strings in `src/setting/**` go there; `extract` handles this split.
