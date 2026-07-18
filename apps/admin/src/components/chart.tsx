import {
  BarChart,
  LineChart
} from 'echarts/charts'
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent
} from 'echarts/components'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

echarts.use([
  BarChart,
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer
])

export function Chart({
  option,
  height = 260,
  className = ''
}: {
  option: EChartsCoreOption
  height?: number
  className?: string
}) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const chart = echarts.init(element, undefined, { renderer: 'canvas' })
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    chart.setOption({
      animation: !reduceMotion,
      animationDuration: 240,
      animationDurationUpdate: 220,
      animationEasing: 'cubicOut',
      aria: { show: true },
      ...option
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [option])

  return (
    <div
      ref={elementRef}
      className={`chart ${className}`}
      style={{ height }}
    />
  )
}
