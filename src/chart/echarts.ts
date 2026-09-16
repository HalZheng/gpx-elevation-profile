import * as echarts from 'echarts/core'
import { LineChart, ScatterChart } from 'echarts/charts'
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
// 沿线地名的标签避让（labelLayout.hideOverlap）依赖这个按需特性，
// 不引入的话 labelLayout 会被静默忽略，密集地名就会叠成一片
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  // 地名标注用散点系列画：只有系列级 labelLayout 支持 hideOverlap
  ScatterChart,
  LabelLayout,
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
