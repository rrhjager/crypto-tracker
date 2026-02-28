export type ThresholdScore = 70 | 80
export type SignalStatus = 'BUY' | 'SELL'

export type QualifiedSignalCandidate = {
  status: SignalStatus
  strength: number
  currentReturnPct: number | null
  daysSinceSignal: number | null
  d7Signal?: number | null
  d30Signal?: number | null
  mfeSignal?: number | null
  maeSignal?: number | null
}

export type QualifiedSignalMetrics = {
  qualityScore: number
  trendScore: number
  peerScore: number
  rewardRisk: number | null
  isLateEntry: boolean
  isOverextended: boolean
  qualifies: boolean
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

function avg(nums: number[]) {
  if (!nums.length) return null
  return nums.reduce((sum, n) => sum + n, 0) / nums.length
}

function calcRewardRisk(item: QualifiedSignalCandidate) {
  const mfe = Number(item.mfeSignal)
  const mae = Number(item.maeSignal)
  if (!Number.isFinite(mfe) || !Number.isFinite(mae) || mae >= 0) return null
  return mfe / Math.max(0.75, Math.abs(mae))
}

function calcBaseQuality(item: QualifiedSignalCandidate, thresholdScore: ThresholdScore) {
  const current = Number.isFinite(item.currentReturnPct as number) ? Number(item.currentReturnPct) : null
  const directional = [item.d7Signal, item.d30Signal, current]
    .map((v) => (Number.isFinite(v as number) ? Number(v) : null))
    .filter((v): v is number => v != null)

  const positiveCount = directional.filter((v) => v > 0).length
  const confirmationRatio = directional.length ? positiveCount / directional.length : 0.5
  const avgDirectional = avg(directional) ?? 0
  const avgDirectionalNorm = clamp((avgDirectional + 6) / 18, 0, 1)

  const rewardRisk = calcRewardRisk(item)
  const rewardRiskNorm = rewardRisk == null ? 0.5 : clamp(rewardRisk / 2.5, 0, 1)

  const days = item.daysSinceSignal
  const freshness =
    days == null
      ? 1
      : days <= 3
        ? 1
        : days <= 10
          ? 1 - ((days - 3) / 7) * 0.25
          : days <= 18
            ? 0.75 - ((days - 10) / 8) * 0.55
            : 0.2

  const strengthNorm = clamp((item.strength - thresholdScore) / Math.max(1, 100 - thresholdScore), 0, 1)
  const profitNorm =
    current == null
      ? 0.5
      : current >= 0
        ? clamp(current / 12, 0, 1)
        : clamp(0.5 + current / 8, 0, 0.5)

  const trendScore = 0.42 * confirmationRatio + 0.33 * avgDirectionalNorm + 0.25 * rewardRiskNorm
  const baseQuality = 0.38 * strengthNorm + 0.32 * trendScore + 0.20 * freshness + 0.10 * profitNorm

  const isLateEntry = days != null && days > 18
  const maxRun = thresholdScore === 80 ? 18 : 14
  const isOverextended = current != null && current > maxRun
  const tooFarUnderwater = current != null && current < -3.5

  const minConfirmation = thresholdScore === 80 ? 0.66 : 0.5
  const minTrendScore = thresholdScore === 80 ? 0.58 : 0.48

  return {
    baseQuality,
    trendScore,
    rewardRisk,
    qualifiesBase:
      !isLateEntry &&
      !isOverextended &&
      !tooFarUnderwater &&
      confirmationRatio >= minConfirmation &&
      trendScore >= minTrendScore,
    isLateEntry,
    isOverextended,
  }
}

export function qualifyActiveSignals<T extends QualifiedSignalCandidate>(items: T[], thresholdScore: ThresholdScore) {
  if (!items.length) return [] as Array<Omit<T, 'quality'> & { quality: QualifiedSignalMetrics }>

  const scored = items.map((item) => {
    const quality = calcBaseQuality(item, thresholdScore)
    const current = Number.isFinite(item.currentReturnPct as number) ? Number(item.currentReturnPct) : 0
    const peerBasis = item.strength * 0.65 + clamp(current, -8, 18) * 1.4

    return {
      item,
      baseQuality: quality.baseQuality,
      trendScore: quality.trendScore,
      rewardRisk: quality.rewardRisk,
      qualifiesBase: quality.qualifiesBase,
      isLateEntry: quality.isLateEntry,
      isOverextended: quality.isOverextended,
      peerBasis,
    }
  })

  const byStatus: Record<SignalStatus, typeof scored> = { BUY: [], SELL: [] }
  for (const row of scored) byStatus[row.item.status].push(row)

  const withPeerScores = (['BUY', 'SELL'] as const).flatMap((status) => {
    const group = byStatus[status]
    if (!group.length) return []

    const sortedPeer = [...group].sort((a, b) => a.peerBasis - b.peerBasis)
    const denom = Math.max(1, sortedPeer.length - 1)
    const peerMap = new Map(sortedPeer.map((row, idx) => [row.item, idx / denom]))

    return group.map((row) => {
      const peerScore = peerMap.get(row.item) ?? 1
      const qualityScore = Math.round(clamp((0.84 * row.baseQuality + 0.16 * peerScore) * 100, 0, 100))
      const minQuality = thresholdScore === 80 ? 62 : 54

      return {
        ...row.item,
        quality: {
          qualityScore,
          trendScore: Math.round(row.trendScore * 100),
          peerScore: Math.round(peerScore * 100),
          rewardRisk: row.rewardRisk,
          isLateEntry: row.isLateEntry,
          isOverextended: row.isOverextended,
          qualifies: row.qualifiesBase && qualityScore >= minQuality,
        },
      }
    })
  })

  return withPeerScores.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'BUY' ? -1 : 1
    if (b.quality.qualityScore !== a.quality.qualityScore) return b.quality.qualityScore - a.quality.qualityScore
    if (b.strength !== a.strength) return b.strength - a.strength
    const aRet = Number.isFinite(a.currentReturnPct as number) ? Number(a.currentReturnPct) : -999999
    const bRet = Number.isFinite(b.currentReturnPct as number) ? Number(b.currentReturnPct) : -999999
    if (bRet !== aRet) return bRet - aRet
    return 0
  })
}
