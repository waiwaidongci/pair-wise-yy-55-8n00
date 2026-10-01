export interface ScoreNote {
  id: string
  key: string
  duration: 'q' | 'h' | '8'
  accidental?: '#' | 'b' | 'n'
  dynamic: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
  tie: boolean
  expression: string
}

export interface Track {
  id: string
  name: string
  instrument: string
  clef: 'treble' | 'bass' | 'alto'
  transposition: number
  color: string
  notes: ScoreNote[]
}

export type NoteField = 'key' | 'duration' | 'accidental' | 'dynamic' | 'tie' | 'expression'

/** 评论：同时支持小节锚点（旧）与音符标识锚点（新），指纹用于失效重算 */
export interface ScoreComment {
  id: string
  measure: number
  author: string
  content: string
  resolved: boolean
  /** 回填后的声部编号 */
  trackId?: string
  /** 稳定音符标识，如 TR-03:N-5 */
  noteId?: string
  /** 出发前记录的小节 */
  baselineMeasure?: number
  /** 锚定时的音符内容 + 移调指纹 */
  signature?: string
  /** 音符或移调变化后置为失效，等待重算/重新锚定 */
  stale?: boolean
  staleReason?: string
}

/** 出发前各声部的小节基线：小节内音符标识顺序与内容指纹 */
export interface MeasureBaseline {
  measure: number
  noteIds: string[]
  noteHash: string
  transposition: number
}

export interface TrackBaseline {
  id: string
  trackId: string
  author: string
  createdAt: string
  measures: MeasureBaseline[]
}

export interface NotePatch {
  noteId: string
  /** 离线改稿出发时看到的字段值，用于三方比对 */
  base: Partial<ScoreNote>
  fields: Partial<ScoreNote>
}

export interface AddedNote {
  note: ScoreNote
  afterNoteId?: string
}

export interface RemovedNote {
  noteId: string
  /** 删除前的音符内容指纹，工作室若又改过则进复核区 */
  contentSignature: string
}

/** 声部长离线改稿后回传的整包：绝不整包覆盖，只按标识与字段合并 */
export interface OfflineBundle {
  id: string
  trackId: string
  author: string
  device: string
  createdAt: string
  baselineId: string
  transpositionFrom: number
  transpositionTo?: number
  patches: NotePatch[]
  added: AddedNote[]
  removed: RemovedNote[]
  /** 演示用：在第 n 个写入操作处模拟一次网络失败，重试后成功 */
  simulateFailAt?: number
}

export type ReviewKind = 'note-field' | 'transposition' | 'note-removed' | 'note-missing'
export type ReviewStatus = 'pending' | 'accepted' | 'rejected'

export interface ReviewItem {
  id: string
  bundleId: string
  trackId: string
  noteId?: string
  kind: ReviewKind
  field?: NoteField
  label: string
  baseValue?: unknown
  offlineValue?: unknown
  studioValue?: unknown
  status: ReviewStatus
  reason: string
}

export type BundleStatus = 'queued' | 'merging' | 'review' | 'completed' | 'failed'

export interface BundleProgress {
  bundleId: string
  trackId: string
  author: string
  status: BundleStatus
  totalOps: number
  /** 已成功写入（落盘）的操作数，失败后从这里接着重试 */
  cursor: number
  attempts: number
  error?: string
  /** 模拟网络抖动：该断点已触发过一次，重试不再失败 */
  breakConsumed?: boolean
  versionId?: string
  updatedAt: string
}

export type PublishingCheckKind = 'spelling' | 'rhythm' | 'pageTurn' | 'cue' | 'transposition'

export interface PublishingCheck {
  id: string
  label: string
  kind: PublishingCheckKind
  trackId?: string
  measure?: number
  status: 'pass' | 'fail'
  detail: string
  signature: string
  /** 依赖的音符/移调变化后已重算，等待确认 */
  recalculated?: boolean
}

export interface ScoreVersion {
  id: string
  author: string
  time: string
  summary: string
  source: 'studio' | 'handoff'
  bundleId?: string
  trackId?: string
  parentVersionId?: string
  /** 全声部快照：旧版本继续可查 */
  trackNotes: Record<string, ScoreNote[]>
  trackTransposition: Record<string, number>
  comments: ScoreComment[]
  publishingChecks: PublishingCheck[]
}
