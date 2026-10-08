import { React } from 'jimu-core'
export default function Widget (props: any) {
  const nls = (id: string) => id
  return <div title="Zoom to selection" aria-label={nls('undo')}>
    <span>Delete everything</span>
    <button aria-label={`Draw ${props.n} shapes`}>{nls('missingKey')}</button>
    <i className="esri-icon-close" />
  </div>
}
