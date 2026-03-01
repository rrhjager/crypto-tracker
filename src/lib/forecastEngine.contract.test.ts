import type { ForecastOutput } from '@/lib/forecastEngine'
import { buildForecast } from '@/lib/forecastEngine'

type BuildForecastOutput = Awaited<ReturnType<typeof buildForecast>>
type Assert<T extends true> = T

type _ForecastReturnShape = Assert<BuildForecastOutput extends ForecastOutput ? true : false>

export const forecastContractExample: Pick<ForecastOutput, 'assetType' | 'horizon' | 'action'> = {
  assetType: 'equity',
  horizon: 14,
  action: 'HOLD',
}
