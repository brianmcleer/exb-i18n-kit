# Wiring a translator into a widget

`extract` only rewrites code where a translator is already in scope. If it reports
`no translator in scope`, add one of these and run it again.

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
