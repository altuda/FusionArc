import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

export function useD3<T extends SVGSVGElement>(
  renderFn: (svg: d3.Selection<T, unknown, null, undefined>) => void,
  deps: unknown[]
) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (ref.current) {
      const svg = d3.select(ref.current)
      renderFn(svg)
    }
  }, deps)

  return ref
}
