import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  MarkAreaComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  MarkAreaComponent,
  MarkPointComponent,
  VisualMapComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  AxisPointerComponent,
  CanvasRenderer,
])

export default echarts
export type EChartsInstance = ReturnType<typeof echarts.init>
